/*
walk nodes
find requires
require the file
add the node to the graph
start/end of that section
once complete
generate the new code blob for each and insert using the resverse insert on source method
https://esprima.readthedocs.io/en/latest/syntactic-analysis.html#example-console-calls-removal
*/

const acorn = require('acorn');
const walk = require("acorn/dist/walk");
const fs = require('fs');
const path = require('path');
const md5 = require('md5');
const escodegen = require('escodegen');

const resolvedModules = {};
const GRAPH = {};

//const ENTRY_POINT = 'demo';
const ROOT_PATH = `${process.cwd()}/demo/`;
const PATH = `${ROOT_PATH}/a.js`;

function cjsTemplate(id, source) {
    return `const require_${id} = (function() { 
        const module = { exports: {}};
        const exports = module.exports;
    
        ${source}
        
        return module.exports;
    });`;
}

function sourceToAST(source) {
    return acorn.parse(source, {
        ecmaVersion: 2018,
        locations: false
    });    
}

// root path should be where the bundler was invoked from
// source path should be where the inital file was loaded from
function walkAndParse(ast, currentPath) {
    walk.simple(ast, {
        CallExpression(node) {
            let fullPath;
            if (node.callee.type === 'Identifier' && node.callee.name === 'require' && node.arguments[0] && node.arguments[0] && node.arguments[0].type === 'Literal') {
                const modulePath = node.arguments[0].value; 
                let currentPathRelativeToBasePath

                /* 
                    this path with normalise the path to the relative directory thats being looked for
                    it will append whatever the current directory path is relative to the entry point module
                    bit more work to do with figuring out the resolver, including trying node modules etc
                */
                //let currentPathRelativeToBasePath = `${ROOT_PATH}${path.dirname(modulePath)}/`;

                /* 
                    relative module or node module 
                    NOTE: if we're in a node module relsotion stage then we want to relatively require from the 
                    node module path. This currently breaks :( theres a few reasons for this around rememenber the current path 
                    and if its relative or a module path and also remembering when we resolve it the resolution had an extention or not
                
                */

                if ( (modulePath.startsWith('./') || modulePath.startsWith('../'))) {
                    fullPath = `${(currentPath || ROOT_PATH)}${modulePath}`;
                    if (fullPath.includes('node_modules')) { 
                        // we're at a relative path within a node module
                        currentPathRelativeToBasePath = currentPath
                    } else {
                        currentPathRelativeToBasePath = `${ROOT_PATH}${path.dirname(modulePath)}/`;
                    }
                } else {
                    const nodeModulePath = `${ROOT_PATH}node_modules/${modulePath}`;

                    /* 
                        check if its a directory or a file
                        if a file we're looking for the installed module 
                        and we want its main file which should be found in package.json

                        if its a file then the require is attempting to include a file from 
                        an install modules so we dont need to find the main we just use that file!
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

                    // finally if we're add a path that relative within a relative module to a node module we build the following string
                    // we want to make sure we keep the full path reference to the node module, this is getting lost when subsequent relaitve paths
                    // are traversed within a node module
                    if (fullPath) {
                        currentPathRelativeToBasePath = `${path.dirname(fullPath)}/`;
                    }
                }

                //console.info(fullPath, currentPathRelativeToBasePath, modulePath);

                let resolved
                if (resolvedModules[fullPath]) {
                    resolved = resolvedModules[fullPath];
                } else {
                    // if full path is undefined then its probably a native module
                    // ultra hack remove this
                    // maybe use this shim
                    // https://github.com/webpack/node-libs-browser
                    if (fullPath === undefined) {
                        resolved = require(modulePath).toString();
                        resolvedModules[modulePath] = resolved;
                        return
                    }

                    resolved = fs.readFileSync(require.resolve(fullPath), 'UTF-8');
                    resolvedModules[fullPath] = resolved;
                }
    
                const id = md5(resolved);
                const edge = {
                    node,
                    resolvedModule: resolved,
                    modulePath: modulePath,
                    fullPath: fullPath,
                    exports: parseExports(resolved, currentPathRelativeToBasePath, id, modulePath),
                    id: id
                }

                node.callee.name = `require_${id}`;

                if (GRAPH[id] === undefined) {
                    GRAPH[id] = (edge);
                }
            }
        }
    });

    return ast;
}

/**
 * Wraps the resolved source in the common JS templates
 * Converts to an new Abstract Syntax Tree
 * Walks the AST and parers any call expressions for require function calls
 */

function parseExports(resolvedSource, currentPath, id) {
    const wrappedSource = cjsTemplate(id, resolvedSource);
    const resolvedAST = sourceToAST(wrappedSource);
    return walkAndParse(resolvedAST, currentPath);
}

function generateCode(init, graph) {
    let modules = Object.keys(graph).map((key, value) => escodegen.generate(graph[key].exports)).join('\n');
    let initaliser = escodegen.generate(init);
    return `${modules}\n${initaliser}`;
}

const start = process.hrtime();
const init = fs.readFileSync(require.resolve(PATH));
const initalAST = sourceToAST(init);
const parsedIntialAST = walkAndParse(initalAST);
const code = generateCode(parsedIntialAST, GRAPH);
// lol this need to go in the parser checking if statements and removing the block
/*
    visit the if statement
    if the check is to check the node env process 
    then check what mode we're in 
    if any dont match the statements and we find a require call within 
    then mark it
*/
const processWrapper = `
    window.process = {
        env: {
            NODE_ENV: 'development'
        }
    };
    process.env.NODE_ENV;`;

const iffe = `(function() {${processWrapper}\n${code}}())`;

fs.writeFileSync(`${__dirname}/generated.js`, iffe, 'UTF-8')


const end = process.hrtime(start);
console.log(`Took: ${end[0]}s ${end[1]/1000000}ms`);