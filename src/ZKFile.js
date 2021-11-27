const MidiTrack = require('./MidiTrack');
const Consts = require('./Consts');
//const { Validator:JSONSchemaValidator } = require('jsonschema');

const DURATION_TAIL_MS = 3000;
//const validator = new JSONSchemaValidator();
//const zk_schema = require('./zk_schema');

function process_meta_event(e,data,bd){
    if(e.type != Consts.events.types.META) return;
    switch(e.subtype){
        case Consts.events.subtypes.meta.SEQUENCE_NUMBER:
            e.msb = data.msb;
            e.lsb = data.lsb;
        break;
        case Consts.events.subtypes.meta.TEXT:
        case Consts.events.subtypes.meta.COPYRIGHT_NOTICE:
        case Consts.events.subtypes.meta.TRACK_NAME:
        case Consts.events.subtypes.meta.INSTRUMENT_NAME:
        case Consts.events.subtypes.meta.LYRICS:
        case Consts.events.subtypes.meta.MARKER:
        case Consts.events.subtypes.meta.CUE_POINT:
            e.content = data.txt;
        break;
        case Consts.events.subtypes.meta.MIDI_CHANNEL_PREFIX:
            e.prefix = data.prefix;
        break;
        case Consts.events.subtypes.meta.END_OF_TRACK: break;
        case Consts.events.subtypes.meta.SET_TEMPO:
            switch(data.type.toLowerCase()){
                case 'bpm':
                    e.tempo = 60000000 / data.tempo;
                    e.tempoBPM = data.tempo;
                break;
                case 'microsec':
                    e.tempo = data.tempo;
                    e.tempoBPM = 60000000 / data.tempo;
                break;
            }
        break;
        case Consts.events.subtypes.meta.SMTPE_OFFSET:
            e.hour = bd[0];
            e.minutes = bd[1];
            e.seconds = bd[2];
            e.frames = bd[3];
            e.subframes = bd[4];
        break;
        case Consts.events.subtypes.meta.TIME_SIGNATURE:
            e.data = bd;
        break;
        case Consts.events.subtypes.meta.KEY_SIGNATURE:
            e.key = data.key;
            e.min = data.min;
        break;
        case Consts.events.subtypes.meta.SEQUENCER_SPECIFIC:
            e.data = bd;
        break;
        default: break;
    }
    return true;
}

function process_midi_event(e,d,bd){
    if(e.type != Consts.events.types.MIDI) return;
    e.channel = bd.shift();
    e.params = bd.map(a => Number.isNaN(a) ? 0 : a);
    return true;
}

function process_midi_system_event(e,d,bd){
    if(
        e.type != Consts.events.types.SYSEX
        && e.type != Consts.events.types.ESCAPE
    ) return;
    e.data = bd;
    if(e.type == Consts.events.types.SYSEX) e.data.push(0xf7);
    return true;
}

function process_event(e,d,bd){
    let s;
    if(s = process_meta_event(e,d,bd)) return;
    if(s = process_midi_event(e,d,bd)) return;
    if(s = process_midi_system_event(e,d,bd)) return;
}

module.exports = class ZKFile{
    constructor(data,strict = false){
        let zk = this.zk = JSON.parse(data);
        //if(strict && validator.validate(zk,zk_schema)) throw new TypeError('Validation failed');
        let { midi } = zk;
        
        // 헤더 처리
        this.header = {
            format:1,
            ticks_per_beat:null,
            tick_resolution:null
        };
        let { header } = midi;
        
        // division 처리
        switch(header.divtype.toLowerCase()){
            case 'tpb':
                // ticks per beat
                // 이 방식일때는 tick resolution을 사용하지 않는걸 강력히 권장
                this.header.ticks_per_beat = header.div0;
                this.header.tick_resolution = 500000 / this.header.ticks_per_beat;
            break;
            case 'smtpe':
                // smtpe(초단위로 계산하는 방식)
                // 따라서 템포의 영향을 받지 않음
                this.header.tick_resolution = 1000000 / (header.div0 * header.div1);
            break;
        }

        // 전역 meta 이벤트 처리
        this.global_events = new MidiTrack(midi.global.meta);
        this.tempo_events = new MidiTrack(midi.global.meta);
        let global_playtick = 0;
        let global_playms = 0;
        let current_tempo_us = 500000;
        midi.global.events.forEach((event,i) => {
            global_playtick += event.i[0];
            
            // smtpe 방식의 파일에서는 자동적으로 NaN이 됨
            let reso = this.header.ticks_per_beat ? (current_tempo_us / this.header.ticks_per_beat) : this.header.tick_resolution;
            global_playms += reso * event.i[0];
            if(event.t != Consts.events.types.META){
                if(strict) throw new TypeError('midi/sysex/escape events cannot be global events');
                return;
            }
            let e = {
                type:event.i[1],
                subtype:event.i[2],
                data_obj:event.d,
                bytes:event.bd,
                playms:global_playms
            };
            process_meta_event(e,event.d,event.bd);
            if(e.subtype == Consts.events.subtypes.meta.SET_TEMPO){
                current_tempo_us = e.tempo;
                this.tempo_events.add_event(global_playtick,e);
            }else{
                this.global_events.add_event(global_playtick,e);
            }
        });
        
        // 개별 이벤트 처리
        this.ports = [];
        let playtick_a = [global_playtick];
        midi.data.forEach(data => {
            let tracks = [];
            data.forEach((trackdata,i) => {
                let track = new MidiTrack(i,trackdata.meta);
                let playtick = 0;
                trackdata.events.forEach(event => {
                    playtick += event.i[0];
                    let e = {
                        type:event.i[1],
                        subtype:event.i[2],
                        data_obj:event.d,
                        bytes:event.bd
                    };
                    process_event(e,event.d,event.bd);
                    track.add_event(playtick,e);
                });
                playtick_a.push(playtick);
                tracks.push(track);
            });
            this.ports.push(tracks);
        });

        // duration = 마지막 midi 또는 global 이벤트 + 3초
        this.header.duration_tick = Math.max(...playtick_a);
        this.header.duration_ms = global_playms;
        let ticks = this.header.duration_tick - global_playtick;
        if(this.header.ticks_per_beat){
            let tevents = this.tempo_events.get_events();
            tevents = tevents[Math.max(...Object.keys(tevents))];
            let last_tempo = tevents[tevents.length-1] ? tevents[tevents.length-1].tempo : 500000;
            this.header.duration_ms += Math.round(last_tempo*(ticks/this.header.ticks_per_beat)/1000);
            this.header.duration_tick += Math.round(DURATION_TAIL_MS*1000/last_tempo*this.header.ticks_per_beat);
        }else{
            this.header.duration_ms += Math.round(ticks*this.header.tick_resolution);
            this.header.duration_tick += Math.round(DURATION_TAIL_MS*1000/this.header.tick_resolution);
        }
    }
}