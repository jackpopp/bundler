const fs = require('fs');
const path = require('path');

module.exports = class Resolver {
    constructor(rootPath) {
        this.rootPath = rootPath
    }

    resolvePath(modulePath, currentPath) {
        let fullPath;
        let newResolutionPath;
    
        if ((modulePath.startsWith('./') || modulePath.startsWith('../'))) {
            fullPath = `${(currentPath)}${modulePath}`;
            newResolutionPath = `${currentPath}${path.dirname(modulePath)}/`;
        } else {
            const nodeModulePath = `${this.rootPath}node_modules/${modulePath}`;
    
            /* 
                check if its a directory or a file
                if a file we're looking for the installed module 
                and we want its main file which should be found in package.json
    
                if its a file then the require is attempting to include a file from 
                within an installed modules so we dont need to find the main entry from the package.json
                 we just use that file!
            */
    
            if (fs.existsSync(nodeModulePath) && fs.lstatSync(nodeModulePath).isDirectory()) {
                const main = JSON.parse(fs.readFileSync(`${nodeModulePath}/package.json`, 'UTF-8')).main || 'index.js';
                fullPath = `${nodeModulePath}/${main}`;
            }
    
            if (fs.existsSync(`${nodeModulePath}`) && fs.lstatSync(`${nodeModulePath}`).isFile()) {
                fullPath = `${nodeModulePath}`;
            }
    
            if (fs.existsSync(`${nodeModulePath}.js`) && fs.lstatSync(`${nodeModulePath}.js`).isFile()) {
                fullPath = `${nodeModulePath}.js`;
            }
    
            // finally lets set the current resolution path based on the full path without the module filename
            // finally lets set the current path relative to the base path and remove the filename
            newResolutionPath = `${path.dirname(fullPath)}/`;
        }
    
        return {
            fullPath,
            newResolutionPath
        }
    }
}
