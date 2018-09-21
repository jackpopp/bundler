# Javascript module bunder

## How does it work

*Source*: https://github.com/jackpopp/bundler/blob/master/src/index.js

A Javascript bundler is essentially a source to source compiler otherwise known as a transpiler. It takes Javascript source code, transforms it in someway and then outputs a different form of the source code. In our case we're taking the individual Javascript source files and bundling them together, rewriting specific pieces of code such as the require calls.

### TL:DR

- Transform inital source code to AST
- Traverse AST and detect require function calls
- Resolve module using the require calls argument
- Wrap resolved module in common JS helper function
- For each resolve module, generate an AST and recursively trasverse the AST
- Add each modified AST to a module graph
- Iterate over the ASTs converting to code using escodegen
- Wrap in an immediately invoked function expression
- Write bundle to file

The bundler begins by reading the initalisation Javascript file and converting this to an Abstract Syntax Tree (AST) following the ecmascript 2018 specification (https://www.ecma-international.org/ecma-262/9.0/index.html#Title). 
An AST is a tree representation of the source code with each node representing a construct in the language.
To parse the inital source file to an AST the Acorn module is used, the resultant AST follows the estree implemention of the spec which can be found here (https://github.com/estree/estree).
Using the speification we can figure out which nodes we want to look for and modify in order to bundle all our code together.
We'll take the AST and we'll use estraverse to travservse the nodes, visiting each node checking the type, modifying, replacing or removing.

### Initial Set up

Create a directory called bundler within there create a demo directory for our demo project and a src directory for our bundler.
Initalise a package.json in the root foler and the demo folder, we'll need a package.json in the demo directory to test bundling node modules.

Create a directory called bundler for all our source code, in here add an src directory for the bundle source and demo directory for our demo project.
In the demo project add we'll add an initalisation source file and a app file and in the src directory we'll add a main file

```bash
mkdir -p bundle/src bundle/demo bundle/demo/utils
cd bundle
npm init --yes
touch src/index.js
cd demo 
touch index.js app.js utils/currentTime.js
npm init --yes
```

In our demo directory we'll set up some require calls and module.export definitions to work again.

```javascript
// demo/index.js

var app = require('./app');
app();

const currentTime = require('./utils/currentTime.js');
currentTime();

for (let i = 0; i < 10; i++) {
    require('./app')();
}

```

```javascript
// demo/app.js

function helloWorld() {
    console.log('Hello World');
    console.log(somethingElse);
}

module.exports = helloWorld;
```

```javascript
// demo/utils/currentTime.js

module.exports = () => {
    console.log(`Date: ${new Date()}`);
}
```

### Creating the inital AST

In the src directory install **acorn** and require it in the index file, create a function that converts a source file to an AST.

```javascript
const acorn = require('acorn');
const path = require('path');

function sourceToAST(source) {
    return acorn.parse(source, {
        ecmaVersion: 2018
    });
}
```

Next create a bundler function that accepts arguments for an entry point and out file, we'll need to create variables for the root path, the inital module and the out file. We'll created these paths based on the current working directory by using the global process object. We'll also run the bundler initalisation and log out paths in the bundler to make sure everything look right.

```javascript
function bundler(entryPoint, out) {    
    const ROOT_PATH = `${path.dirname(`${process.cwd()}/${entryPoint}`)}/`;
    const MODULE_PATH = `${process.cwd()}/${entryPoint}`;
    const OUT_PATH = `${process.cwd()}/${out}`;

    console.log(JSON.stringify({ ROOT_PATH, MODULE_PATH, OUT_PATH }, null, 2));
}

bundler('demo/index.js', `generated.js`);
```

We should see a nicely formatted object of all our paths with our variables as keys like so:

```bash
{
  "ROOT_PATH": "/Users/dauser/Workspace/bundler/demo/",
  "MODULE_PATH": "/Users/dauser/Workspace/bundler/demo/index.js",
  "OUT_PATH": "/Users/dauser/Workspace/bundler/generated.js"
}
```

Next up we need to pass our inital module to the function that generates the AST and we'll have our inital AST that we can start working with.
So lets remove the `console.log` call that we added earlier and instead read in the file and pass the source to the function.

```javascript
function bundler(entryPoint, out) {    
    const ROOT_PATH = `${path.dirname(`${process.cwd()}/${entryPoint}`)}/`;
    const MODULE_PATH = `${process.cwd()}/${entryPoint}`;
    const OUT_PATH = `${process.cwd()}/${out}`;

    const init = fs.readFileSync(MODULE_PATH, 'UTF-8');
    const initalAST = sourceToAST(init);
}
```

We've now got our inital AST which we can traverse to find all the `require` function calls, we'll process these in order to bundle all the modules and we'll need to do this recruively both with the inital tree and recursively traverse each module. 

### Visiting nodes

Lets take a look at the AST in order to get a better idea of how its structured and how we'll traverse it.
We can use https://astexplorer.net/ to see a visualisation of the the source as an AST, we can open and close the different nodes and view all the different properties that different nodes contain.

For supporting the common JS require hook we will need to visit the **CallExpression** node, since this expression denotes when a function is called.
An example of this would be:

```javascript
const myModule = require('./my-module'); // this is a call expression
```

We'll take a simple example and convert that to an AST with the AST Explorer:

// Image goes here

```json
{
  "type": "Program",
  "start": 0,
  "end": 40,
  "body": [
    {
      "type": "VariableDeclaration",
      "start": 0,
      "end": 40,
      "declarations": [
        {
          "type": "VariableDeclarator",
          "start": 6,
          "end": 39,
          "id": {
            "type": "Identifier",
            "start": 6,
            "end": 14,
            "name": "myModule"
          },
          "init": {
            "type": "CallExpression",
            "start": 17,
            "end": 39,
            "callee": {
              "type": "Identifier",
              "start": 17,
              "end": 24,
              "name": "require"
            },
            "arguments": [
              {
                "type": "Literal",
                "start": 25,
                "end": 38,
                "value": "./my-module",
                "raw": "'./my-module'"
              }
            ]
          }
        }
      ],
      "kind": "const"
    }
  ],
  "sourceType": "module"
}
```

In the above source code we can see a multitude of node types, a source file generated from acorn will start with a root we start with a root node of type *Program* and a body property of type array. Within the body property we'll see all the top level nodes and each of these nodes will propertyies based on the types and these will be a mixture of other nodes or properties shared amongst all nodes. For example all nodes have a type (the node type), start (the starting character position) and end (the end character position). Any node with a block will have a body of new nodes and these are a new scope, there's a lot of stuff that may need to be kept track of although require calls are straightforward for the most part.

In the above example we can see that we start with a *VariableDeclaration* this contains an array of declartions including *id* which is a reference to the identifier and a *init* property which is the initaliser of the variable declaration, this is basically what the variable will initalise to. 
For example:

```
const value = 1;
```

In the above example the id is *value* and the initaliser is the literal value *1*, to figure out what all the node types are we can look at the specification that acorn follows for creating an AST. Acorn follows the estree specification which can be viewed on github at:
https://github.com/estree/estree

There is a specification which matches each release of the Ecmascript specificaion, such as es5, es2015 etc.
We'll be using the *estraverse* module in order to traverse the AST and visit nodes that we will need to transform, so to begin install and require *estraverse*

```bash
npm install estraverse
```

```javascript
const estraverse = require('estraverse');
```

Next lets create a new function called *walkAndParse*, which will visit all the nodes in the AST and allow you to check each, conditionally making operations on each.
This is called the visitor pattern - url here, we can visit each node do an operation either when we enter or leave the node, with the estraverse *replace* function we must return the node at the end of the function.
The basic operation that we will be doing by walking each node is to look for the require calls, we'll then need to resolve the module and parse that module along with adding it to our list of modules. For each moduel that is resvoled from a source file we'd need to resurively call *walkAndParse* again, by the end process we should end up with a dependcy graph of all modules that can be bundled together.

When we visit this node we will be given the node object along with its properties, these properties can be found by viewing the estree specification.
https://github.com/estree/estree/blob/master/es5.md#callexpression

```javascript
function walkAndParse(ast, currentPath, resolver) {

    estraverse.replace(ast, {
        enter(node) {
            if (node.type === 'CallExpression') {
                // start checking here
            }

            return node;
        }
    }
}
```

First we want to check that the call expression callee type is an identifier, the identifier is the name of the function that is being called
We need to check this is that you can have call expressions for an anonymous function which has no idientifier and instead would have a function expression.
If it was a function expression then it could not be making a call to *require*.
https://github.com/estree/estree/blob/master/es5.md#identifier

If the callee has no identifier for this node then we dont attempt to parse it, the walker will still visit its child nodes as there may be require call expressions further down that branch.

If we do find that the callee has an identifier then we can check the identifer name and if this is *require*, then we now know we've hit an require call. 
The final step it to check if the require call has been given any arguments, we need a single argument and we exprect this to be a string literal.
Literals are static expressions within the source code, they are static values defined within the code and are not variable.
https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Grammar_and_Types#Literals
https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Grammar_and_Types#String_literals

```javascript
function walkAndParse(ast, currentPath, resolver) {

    estraverse.replace(ast, {
        enter(node) {
            if (node.type === 'CallExpression') {
                if (node.callee.type === 'Identifier' && node.callee.name === 'require' && node.arguments[0] && node.arguments[0] && node.arguments[0].type === 'Literal') {
                    // attemp to resolve module here
                }
            }

            return node;
        }
    }
}
```

We most likely also want to check in the above test that the literal value is also a string since intergers and booleans are also literals, but we'll skip this for now.

### Resolving modules

Now that a require call expression with a literal expression has been identified, the module resolution needs to take place in order to find the correct path to the module.
There are numerous ways that a module call be resolved using require and a some different cases for each, below are the three main ways we can resolve modules.

#### Absolute module path

```
require('/Users/dauser/somemodule');
```

An absolute module path allows the require call to reference any module on the file system, the module bundler wont be implementing this type of path resolution. The reason for this being that most published modules will not make references to absolute paths and in general a developer will not make use of absolut paths.

#### Relative module path

```
require('./somemodule.js');
```

A relative module path allows the require call to look for a module that's relative to the current module, you look in the current directory or move up directories using `..` for each directory you wsh to move up.
With both absolute and relative module paths following the node commonjs pattern a file extention is not required, so this needs to be added as required during module resolution.

#### Node module path

```
require('react');
```

A node module path allows require to resolve modules installed via npm/yarn et all and reside within the node_module folders. This is an extremely common pattern which has a few caveats, of the different resolution paths this is the most complex. 

When resolving a module such as the *react* example above we're using an identifier to the installed directory name within the node module, so within node_modules you will see a directory called react. If you look within the directory there is no file called react, so what exactly is going to be resolved? 

When a node_module is installed the modules package.json is also installed, within this file there can be an optional reference to a *main* file which tells us what the inital file for the module should be. Since this is optional the fallback for this is to look for a *index.js* file if there is no main property within the package.json, the index.js name is a refernce to how webservers have default *index.html* files that are served for web requests.

Next there is the ability to require a file from the directory of an installed node module, for example if we were using lodash we can only require the methods we need

```
const partition = require('lodash/partition');
```

We're create the resolver in another file and export the class for use by the bundler, so create a file called *resolver.js*.

In the code we export a resolver class that requires the root path, which we'll need whenever we want to resolve a node module.
We're using the path module to help with path formatting and the fs module to retrieve information about the module that is being resolved.

The class has a single function called resolvePath which has two parameters `modulePath` and `currentPath`.
Module path is the path module that is now being resolved, where as currentPath is the path to module where the require call has been made. 

Then we want to return an object with two properties `fullPath` and `newResolutionPath`. The fullPath property is the path we have resolved and the newResolutionPath property is the fullPath without the module name. The newResolutionPath property will then be used as the currentPath arguement later on by the bundler if it finds any require calls in the module we have just resolved.

So lets add that:

```javascript
const fs = require('fs');
const path = require('path');

module.exports = class Resolver {
    constructor(rootPath) {
        this.rootPath = rootPath
    }

    resolvePath(modulePath, currentPath) {
        let fullPath;
        let newResolutionPath;
    
        return {
            fullPath,
            newResolutionPath
        }
    }
}

```

Next up we'll add the logic for all the different possible module paths, we'll use an if statement to test if the path is relative otherwise assume its a node module.
First we check if there module starts with `./` or `../` if it does then we expect its a relative path, set the `fullPath` to the current path with the module path from the require argument appended

The node module resolution is a little more complex, the require call could be targeting a directory or a file within a directory. Since the require statements do not mandate a file extension we need to check if it's a directory or a file that is being referenced. If it's a directory then we must also try and load the package.json in order to check if a main entry point has been defined, if it has we use it and if it hasnt we default to `index.js`. Next we'll append a `.js` to the `modulePath` as a variable called `nodeModulePathWithExtension` if it doesnt have one and check if it's a valid file, if it is then assign `fullPath` to `nodeModulePathWithExtension`.

Finally the `newResolutionPath` is the same as the fullPath but without the directory name of the path, we can achieve this using `path.dirname`.


```javascript
resolvePath(modulePath, currentPath) {
        let fullPath;

        if ((modulePath.startsWith('./') || modulePath.startsWith('../'))) {
            fullPath = `${(currentPath)}${modulePath}`;
        } else {
            const nodeModulePath = `${this.rootPath}node_modules/${modulePath}`;
    
            if (fs.existsSync(nodeModulePath) && fs.lstatSync(nodeModulePath).isDirectory()) {
                const main = JSON.parse(fs.readFileSync(`${nodeModulePath}/package.json`, 'UTF-8')).main || 'index.js';
                fullPath = `${nodeModulePath}/${main}`;
            }
    
            const nodeModulePathWithExtension = nodeModulePath.endsWith('.js') ? nodeModulePath : `${nodeModulePath}.js`;
    
            if (fs.existsSync(nodeModulePathWithExtension) && fs.lstatSync(nodeModulePathWithExtension).isFile()) {
                fullPath = nodeModulePathWithExtension;
            }
        }

        const newResolutionPath = `${path.dirname(fullPath)}/`;
    
        return {
            fullPath,
            newResolutionPath
        }
    }
```

### Wrapping and recursively parsing

tbc

### Conditional bundling with NODE_ENV

tbc

### Code generation

tbc

## TODO

- ES Module - http://exploringjs.com/es6/ch_modules.html#sec_overview-modules
- Use proper graph
- Try code splitting
- Scope hoisting

References:

https://www.ecma-international.org/ecma-262/
https://nodejs.org/docs/latest/api/modules.html#modules_the_module_object
https://github.com/webpack/docs/wiki/commonjs
https://stackoverflow.com/questions/16383795/difference-between-module-exports-and-exports-in-the-commonjs-module-system
