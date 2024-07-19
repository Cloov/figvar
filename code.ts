// Code in this file has access to the *figma document* via the figma global object.
// Access browser APIs in the <script> tag inside "ui.html" which has a
// full browser environment (See https://www.figma.com/plugin-docs/how-plugins-run).

const options: ShowUIOptions = {
  title: "figvar",
  width: 380,
  height: 660,
};
figma.showUI(__html__, options);

type VarType = "STRING" | "FLOAT" | "COLOR" | "BOOLEAN";

interface CollectionData {
  name: string;
  variables: VarData[];
  modes: ModeData[];
}

interface ModeData {
  name: string;
  id: string;
}

interface VarData {
  id: string;
  name: string;
  type: VarType;
  value: any;
}

figma.ui.onmessage = (message: any): void => messageFunctionLookup[message.type](message);

const messageFunctionLookup: { [key: string]: (msg: any) => void } = {
  start: startPlugin,
  close: closePlugin,
  "create-rectangles": createRectangles,
  "import-json": importVarsJson,
  "show-json": showVarsJson,
  "save-json": saveVarsAsJson,
  "clear-vars": clearVars,
  "save-css": saveVarsAsCss,
  "show-css": showVarsCss,
  "replace-vars": modifyNames,
  realias: realias,
};

async function startPlugin(message: any): Promise<void> {
  await listCssInUi();
}

async function listVariablesInUi(): Promise<void> {
  const varCollections = await figma.variables.getLocalVariableCollectionsAsync();
  let json: any = {};
  for (let i = 0; i < varCollections.length; i++) {
    let collection = varCollections[i];
    json[collection.name] = await getCollectionAsJson(collection);
  }
  let data = JSON.stringify(json, null, 2);
  figma.ui.postMessage({ type: "populate-textarea", data: data });
}

async function listCssInUi(): Promise<void> {
  const data = await getVarsCssText();
  figma.ui.postMessage({ type: "populate-textarea", data: data });
}

async function getVarsCssText(): Promise<string> {
  const varCollections = await figma.variables.getLocalVariableCollectionsAsync();
  let data: string = ":root {\n";
  for (let i = 0; i < varCollections.length; i++) {
    let collection = varCollections[i];
    let collectionData: CollectionData = await getCollectionAsJson(collection);
    data += `\n`;
    data += `  /* ${collectionData.name} */\n`;
    data += `\n`;
    const collName = collectionData.name.replace(/ /g, "").toLowerCase();
    let modeCount = collectionData.modes.length;

    collectionData.variables.forEach((variable) => {
      for (let modeName in variable.value) {
        let valueForMode = variable.value[modeName];
        let resolvedValue: string | null;
        if (valueForMode.type == "VARIABLE_ALIAS") {
          resolvedValue = `var(${valueForMode.name})`;
        } else {
          resolvedValue = valueToString(valueForMode, variable.type);
        }
        if (resolvedValue != null) {
          let modeToken = modeCount > 1 ? `-${modeName.toLowerCase()}` : "";
          const safeVarName = variable.name.replace(/[\s/]/g, "-");
          data += `  --${collName}-${safeVarName}${modeToken}: ${resolvedValue};\n`;
        }
      }
    });
  }
  data += `}\n`;
  return data;
}

function valueToString(value: any, type: any): string | null {
  const toHex = (rgb: number): string => {
    let hex = Math.round(rgb * 255).toString(16);
    return hex.length == 1 ? "0" + hex : hex;
  };
  switch (type) {
    case "STRING":
      return `"${value}"`;
    case "FLOAT":
      return `${value}`;
    case "COLOR":
      if (value.a === 1) return `#${toHex(value.r)}${toHex(value.g)}${toHex(value.b)}`;
      return `rgba(${value.r}, ${value.g}, ${value.b}, ${value.a})`;
    case "BOOLEAN":
      return `${value}`;
    default:
      return null;
  }
}

function closePlugin(message: any): void {
  figma.closePlugin();
}

function createRectangles(message: any): void {
  const { count } = message;
  const nodes: SceneNode[] = [];
  for (let i = 0; i < count; i++) {
    const rect = figma.createRectangle();
    rect.x = i * 150;
    rect.fills = [{ type: "SOLID", color: { r: 1, g: 0.5, b: 0 } }];
    figma.currentPage.appendChild(rect);
    nodes.push(rect);
  }
  figma.currentPage.selection = nodes;
  figma.viewport.scrollAndZoomIntoView(nodes);
}

async function getCollectionAsJson(collection: VariableCollection): Promise<CollectionData> {
  let varDatas: VarData[] = [];
  for (let i = 0; i < collection.variableIds.length; i++) {
    let variableId = collection.variableIds[i];
    let variable = await figma.variables.getVariableByIdAsync(variableId);
    if (variable) {
      let valuesByModeName: { [key: string]: any } = {};
      let modes: any[] = [];
      collection.modes.forEach((mode) => modes.push(mode));
      for (let i = 0; i < modes.length; i++) {
        let mode = modes[i];
        let modeName = mode.name;
        let value: any = variable.valuesByMode[mode.modeId];
        if (value.type == "VARIABLE_ALIAS") {
          let aliasedVar = await figma.variables.getVariableByIdAsync(value.id);
          if (aliasedVar) {
            let id = aliasedVar.variableCollectionId;
            let collection = await figma.variables.getVariableCollectionByIdAsync(id);
            if (collection) {
              const collName = collection.name.replace(/ /g, "").toLowerCase();
              value.name = `--${collName}-${aliasedVar.name}`;
            }
          }
        }
        valuesByModeName[modeName] = value;
      }
      const varData: VarData = {
        id: variable.id,
        name: variable.name,
        type: variable.resolvedType as VarType,
        value: valuesByModeName,
      };
      varDatas.push(varData);
    }
  }
  let modeDatas: ModeData[] = [];
  for (let mode of collection.modes) {
    modeDatas.push({ name: mode.name, id: mode.modeId });
  }
  let collectionData: CollectionData = {
    variables: varDatas,
    name: collection.name,
    modes: modeDatas,
  };
  return collectionData;
}

interface AliasRequirement {
  variable: Variable;
  modeName: string;
  targetVarName: string;
}

async function importVarsJson(message: any): Promise<void> {
  const json = JSON.parse(message.text);

  let aliasRequirements: { [id: string]: AliasRequirement } = {};
  let collectionsByName: { [name: string]: VariableCollection } = {};
  let variablesByFullName: { [name: string]: Variable } = {};

  for (let collectionName in json) {
    const collectionData: CollectionData = json[collectionName] as CollectionData;
    const collection = await figma.variables.createVariableCollection(collectionName);
    collectionsByName[collectionName] = collection;
    const modeDatas = collectionData.modes;
    let createdModeIds: string[] = [];
    for (let i = 0; i < modeDatas.length; i++) {
      let modeData: ModeData = modeDatas[i];
      let newModeId = await collection.addMode(modeData.name);
      createdModeIds.push(newModeId);
    }
    // Iterate over collection.modes and delete any that are not in modeDatas
    // place collection.modes into an array
    let modes = Array.from(collection.modes);
    for (let i = modes.length - 1; i >= 0; i--) {
      if (createdModeIds.indexOf(modes[i].modeId) === -1) {
        //console.log("Removing standard mode: ", modes[i].name);
        await collection.removeMode(modes[i].modeId);
      }
    }
  }

  for (let collectionName in json) {
    const collectionData: CollectionData = json[collectionName] as CollectionData;
    const collection = collectionsByName[collectionName];
    for (let i = 0; i < collectionData.variables.length; i++) {
      let varData = collectionData.variables[i];
      let variable = await figma.variables.createVariable(varData.name, collection, varData.type);
      let fullName = "--" + collection.name.replace(/ /g, "").toLowerCase() + "-" + varData.name;
      variablesByFullName[fullName] = variable;
      for (let onFileModeName in varData.value) {
        let liveMode = collection.modes.find((liveMode) => {
          return liveMode.name === onFileModeName;
        });
        if (liveMode) {
          let value = varData.value[liveMode.name];
          if (value.type === "VARIABLE_ALIAS") {
            aliasRequirements[value.id] = {
              variable: variable,
              modeName: liveMode.name,
              targetVarName: value.name,
            };
          } else {
            await variable.setValueForMode(liveMode.modeId, value);
          }
        } else {
          console.log(`Variables mode ${onFileModeName} not found in collection '${collection.name}'`);
          console.error(`Variables mode ${onFileModeName} not found in collection '${collection.name}'`);
        }
      }
      collection.variableIds.push(variable.id);
    }
  }

  for (let aliasId in aliasRequirements) {
    let requirementInfo = aliasRequirements[aliasId];
    let variableName = requirementInfo.variable.name;
    let collectionId = requirementInfo.variable.variableCollectionId;
    let collection = await figma.variables.getVariableCollectionByIdAsync(collectionId);
    if (collection) {
      let mode = collection.modes.find((mode) => {
        return mode.name === requirementInfo.modeName;
      });
      console.log(
        `Variable '${variableName}' needs alias '${requirementInfo.targetVarName}' for mode '${mode?.name}' (${aliasId})`
      );
    }
  }

  for (let collectionName in json) {
    const collectionData: CollectionData = json[collectionName] as CollectionData;
    const collection = collectionsByName[collectionName];
    for (let i = 0; i < collectionData.variables.length; i++) {
      let varData = collectionData.variables[i];
      for (let onFileModeName in varData.value) {
        let liveMode = collection.modes.find((liveMode) => {
          return liveMode.name === onFileModeName;
        });
        if (liveMode) {
          let value = varData.value[liveMode.name];
          if (value.type === "VARIABLE_ALIAS") {
            let targetVariable = variablesByFullName[value.name];
            let variableAlias = await figma.variables.createVariableAlias(targetVariable);
            aliasRequirements[value.id].variable.setValueForMode(liveMode.modeId, variableAlias);
          }
        } else {
          console.log(`Variables mode ${onFileModeName} not found in collection '${collection.name}'`);
          console.error(`Variables mode ${onFileModeName} not found in collection '${collection.name}'`);
        }
      }
    }
  }
  //listVariablesInUi();
  listCssInUi();
}

async function showVarsJson(message: any): Promise<void> {
  listVariablesInUi();
}

async function clearVars(message: any): Promise<void> {
  const varCollections = await figma.variables.getLocalVariableCollectionsAsync();
  for (let i = 0; i < varCollections.length; i++) {
    let collection = varCollections[i];
    await collection.remove();
  }
  listCssInUi();
}

async function saveVarsAsJson(): Promise<void> {
  const varCollections = await figma.variables.getLocalVariableCollectionsAsync();
  let json: any = {};
  for (let i = 0; i < varCollections.length; i++) {
    let collection = varCollections[i];
    json[collection.name] = await getCollectionAsJson(collection);
  }
  const data: any = { figmaDocName: figma.root.name, text: JSON.stringify(json) };
  figma.ui.postMessage({ type: "save-json", data: data });
}

async function showVarsCss(): Promise<void> {
  listCssInUi();
}

async function findVariableByName(name: string): Promise<Variable | null> {
  const collections = await figma.variables.getLocalVariableCollectionsAsync();
  for (let i = 0; i < collections.length; i++) {
    let variableIds = collections[i].variableIds;
    for (let j = 0; j < variableIds.length; j++) {
      let variable = await figma.variables.getVariableByIdAsync(variableIds[j]);
      if (variable && variable.name == name) return variable;
    }
  }
  return null;
}

async function realias(message: any): Promise<void> {
  const varname = message.varname;
  const alias = message.alias;
  let aliasVariable = await findVariableByName(alias);
  if (!aliasVariable) {
    figma.ui.postMessage({ type: "findreplace-info", data: `Could not find variable '${alias}'` });
    return;
  }
  const collections = await figma.variables.getLocalVariableCollectionsAsync();
  for (let i = 0; i < collections.length; i++) {
    let collection = collections[i];
    let variableIds = collection.variableIds;
    for (let j = 0; j < variableIds.length; j++) {
      let variableId = variableIds[j];
      let variable = await figma.variables.getVariableByIdAsync(variableId);
      if (variable && variable.name == varname) {
        let alias = await figma.variables.createVariableAlias(aliasVariable);
        for (let k = 0; k < collection.modes.length; k++) {
          const modeId = collection.modes[k].modeId;
          await variable.setValueForMode(modeId, alias);
        }
      }
    }
  }
  listCssInUi();
}

async function modifyNames(message: any): Promise<void> {
  const findString = message.findString;
  const replaceString = message.replaceString;
  let numReplacements: number = 0;

  if (message.inVars) {
    const varCollections = await figma.variables.getLocalVariableCollectionsAsync();
    for (let i = 0; i < varCollections.length; i++) {
      let collection = varCollections[i];
      for (let j = 0; j < collection.variableIds.length; j++) {
        let variableId = collection.variableIds[j];
        let variable = await figma.variables.getVariableByIdAsync(variableId);
        if (variable) {
          let newName = variable.name.replace(findString, replaceString);
          if (newName != variable.name) {
            numReplacements++;
            variable.name = newName;
          }
        }
      }
    }
  }
  if (message.inCollections) {
    const varCollections = await figma.variables.getLocalVariableCollectionsAsync();
    for (let i = 0; i < varCollections.length; i++) {
      let collection = varCollections[i];
      let newName = collection.name.replace(findString, replaceString);
      if (newName != collection.name) {
        numReplacements++;
        collection.name = newName;
      }
    }
  }
  if (message.inModes) {
    const varCollections = await figma.variables.getLocalVariableCollectionsAsync();
    for (let i = 0; i < varCollections.length; i++) {
      let collection = varCollections[i];
      for (let j = 0; j < collection.modes.length; j++) {
        let mode = collection.modes[j];
        let newName = mode.name.replace(findString, replaceString);
        if (newName != mode.name) {
          numReplacements++;
          collection.renameMode(mode.modeId, newName);
        }
      }
    }
  }
  if (message.inGroups) {
  }

  let instancesToken = `${numReplacements} ${numReplacements == 1 ? " instance" : " instances"}`;
  const messageText = `Replaced ${instancesToken} of ${findString} with ${replaceString}`;
  figma.ui.postMessage({ type: "findreplace-info", data: messageText });
  listCssInUi();
}

async function saveVarsAsCss(): Promise<void> {
  const cssText = await getVarsCssText();
  const data: any = { figmaDocName: figma.root.name, text: cssText };
  figma.ui.postMessage({ type: "save-css", data: data });
}
