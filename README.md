# Javascript module bunder

## How does it work

*Source*: https://github.com/jackpopp/bundler/blob/master/src/index.js

The bundler begins by reading the initalisaton JS file and converting this to an Abstract Syntax Tree (AST) following the ecmascript 2018 specification (https://www.ecma-international.org/ecma-262/9.0/index.html#Title).
To parse the inital source file to an AST the Acorn module is used, the resultant AST follows the estree implemention of the spec which can be found here (https://github.com/estree/estree).
Using the speification we can figure out which nodes we want to look for and modify in order to bundle all our code together.
We'll take the AST and we'll use estraverse to travservse the nodes, we'll use the replace function to visit each node check the type and modify, replace or remove.
To do this we pass an object with a property with the name of the node type we want to visit, this takes a callback which will have parameter containing the node we visiting.

### Visiting nodes

For supporting the common JS require hook we will need to visit the **CallExpression** node, since this expression denotes when a function is called.
An example of this would be:

```javascript
require('my-module') // this is a call expression
```

When we visit this node we will be given the node object along with its properties, these properties can be found by viewing the estree specification.
https://github.com/estree/estree/blob/master/es5.md#callexpression

First we want to check that the call expression callee type is an identifier, and identifier is basically the name of the function. 
We need to check this is that you can have call expressions for an anonymous function which has no idientifier and instead would have a function expression.
https://github.com/estree/estree/blob/master/es5.md#identifier

If the callee has no identifier for this node then we dont attempt to parse it, the walker will still visit its child nodes as there may be require call expressions further down that branch.
If we do find that the callee has an identifier then we can check the identifer name and if this is **require**, then we now know we've hit an require call. 
The final step it to check if the require call has been given any arguments, we need a single argument and we exprect this to be a string literal.
Literals are static expressions within the source code, they are static values defined within the code and are not variable.
https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Grammar_and_Types#Literals
https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Grammar_and_Types#String_literals

### Resolving modules

tbc

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
