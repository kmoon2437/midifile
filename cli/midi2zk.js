const fs = require('fs');
const { program } = require('commander');
const { ZKFileConverter } = require('../index');

program
.version(require('../package.json').version, '-v, --version')
.usage('<input file> <output file> --compress <raw|deflate|gz>')
.description('Convert midi file to zk file')
.option('-c, --compress <raw|deflate|gz>', 'compression algorithm')
.parse(process.argv);

let [ input,output ] = program.args;
let opts = program.opts();

fs.writeFileSync(output,ZKFileConverter.midi2zk(fs.readFileSync(input),opts.compress || 'raw'));