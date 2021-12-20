# zxe-midi-file
midi/zk file parser

## About zk file
The zk(**Z**XE**K**araoke) file is a file format created for use in [zxe-karaoke-player](https://github.com/kmoon2437/zxe-karaoke-player).

## Usage
```js
const fs = require('fs');
const { MidiFile,ZKFile,ZKFileConverter } = require('zxe-midi-file');

let midi = fs.readFileSync('...'); // your midi file. it can be an ArrayBuffer or Uint8Array or nodejs Buffer

let file = new MidiFile(midi); // MidiFile instance
file.header.format; // 0,1 or 2
file.header.ticksPerBeat; // If division is frames per seconds, this is null
file.header.tickResolution; // microseconds per tick
file.header.tracksCount; // n
file.header.durationTick; // duration in tick
file.header.durationMs; // duration in ms

file.tracks; // array
file.tempoEvents; // "set tempo" events

let zk = fs.readFileSync('...'); // your zk file. it can be an ArrayBuffer or Uint8Array or nodejs Buffer

let file2 = new ZKFile(zk); // ZKFile instance
file2.header; // similar to MidiFile.header

file2.globalEvents; // global events
file2.tempoEvents; // "set tempo" events
file2.ports; // array

let midi2 = fs.readFileSync('...'); // your midi file. it can be an ArrayBuffer or Uint8Array or nodejs Buffer
fs.writeFileSync('./test.zk',ZKFileConverter.midi2zk(midi2)); // write zk file
```

## Others
This library is using [midifile](https://github.com/nfroidure/midifile) to parse midi files.