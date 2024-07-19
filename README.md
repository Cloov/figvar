# figvar

### Setup

1. Download repo: https://github.com/Cloov/figvar
2. In the repo project, run `npm install` then `npm run build`.
3. Ensure the Figma desktop app is open, and a relevant document is active
4. From the Plugins menu in the menu bar, go to **Development > Import Plugin** From Manifest
5. Navigate to and select **manifest.json** from the **figvar** directory
6. Now, you should be able to run the plugin by going to **Plugins > Development > figvar**

Once the plugin is recognised by the desktop app, you should be able to run the plugin on any document if you re-run the plugin. It should always operate on the active document as the plugin has an instance per document.

##### Tips

- In the Plugins > Development menu, use Show/Hide Console if something doesn't seem right, and we can investigate any errors
