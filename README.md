# @kmoon2437/midifile
midi/yjk file parser

## About yjk file
The yjk(**YJK**araoke) file is a file format created for use in [yj-karaoke-player](https://github.com/kmoon2437/yj-karaoke-player).

## Usage
```js
const fs = require('fs');
const { MidiFile,YJKFile,YJKFileConverter } = require('@kmoon2437/midifile');

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

let yjk = fs.readFileSync('...'); // your yjk file. it can be an ArrayBuffer or Uint8Array or nodejs Buffer

let file2 = new YJKFile(yjk); // YJKFile instance
file2.header; // similar to MidiFile.header

file2.globalEvents; // global events
file2.tempoEvents; // "set tempo" events
file2.ports; // array

let midi2 = fs.readFileSync('...'); // your midi file. it can be an ArrayBuffer or Uint8Array or nodejs Buffer
fs.writeFileSync('./test.yjk',YJKFileConverter.midi2yjk(midi2)); // write yjk file
```

## Others
This library is using [midifile](https://github.com/nfroidure/midifile) to parse midi files.