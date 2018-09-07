var helloWorld = require('./b.js');
require('./folder/something.js');
helloWorld();

const banana = require('./utils/banana.js');
banana();

for (let i = 0; i < 10; i++) {
    require('./b.js')();
}
