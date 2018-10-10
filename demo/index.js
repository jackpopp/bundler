const app = require('/Users/hannij11/Workspace/bundler/demo/app');
const partition = require('lodash/partition');

require('./folder/something.js');
app();

const currentTime = require('./utils/currentTime.js');
currentTime();

for (let i = 0; i < 10; i++) {
    require('./app')();
}

console.log(partition([1, 2, 3, 4], n => n % 2));
