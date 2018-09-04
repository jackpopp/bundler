const somethingElse = require('./folder/something-else.js');

function helloWorld() {
    console.log('Hello World');
    console.log(somethingElse);
}

module.exports = helloWorld;