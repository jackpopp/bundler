const fs = require('fs');
const path = require('path');

module.exports = class Resolver {
    constructor(rootPath) {
        this.rootPath = rootPath
    }

    resolvePath(modulePath, currentPath) {
        let fullPath;
    
        /**
         * Check if the module path starts with a relative file path, 
         * then we can just build the path based on the current path
         */

        if ((modulePath.startsWith('./') || modulePath.startsWith('../'))) {
            const nodeModulePathWithExtension = modulePath.endsWith('.js') ? modulePath : `${modulePath}.js`;
            fullPath = `${(currentPath)}${nodeModulePathWithExtension}`;
        } else {
            /**
             * If its not a realtive path then we're assuming its a node module
             */
            const nodeModulePath = `${this.rootPath}node_modules/${modulePath}`;
    
            /** 
            *    check if its a directory or a file
            *    if a file we're looking for the installed module 
            *    and we want its main file which should be found in package.json
            *
            *    if its a file then the require is attempting to include a file from 
            *    within an installed modules so we dont need to find the main entry from the package.json
            *    we just use that file!
            */
    
            if (fs.existsSync(nodeModulePath) && fs.lstatSync(nodeModulePath).isDirectory()) {
                const main = JSON.parse(fs.readFileSync(`${nodeModulePath}/package.json`, 'UTF-8')).main || 'index.js';
                fullPath = `${nodeModulePath}/${main}`;
            }

            const nodeModulePathWithExtension = nodeModulePath.endsWith('.js') ? nodeModulePath : `${nodeModulePath}.js`;
    
            if (fs.existsSync(nodeModulePathWithExtension) && fs.lstatSync(nodeModulePathWithExtension).isFile()) {
                fullPath = nodeModulePathWithExtension;
            }
        }

         /**
         * finally lets set the current resolution to the full path without the module filename
         */
            
        const newResolutionPath = `${path.dirname(fullPath)}/`;
    
        return {
            fullPath,
            newResolutionPath
        }
    }
}
