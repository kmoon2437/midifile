const MidiTrack = require('./MidiTrack');
const Consts = require('./Consts');
const { BinaryXML } = require('zxe-binaryxml');
const fs = require('fs');
//const { Validator:JSONSchemaValidator } = require('jsonschema');

const DURATION_TAIL_MS = 3000;
//const validator = new JSONSchemaValidator();
//const zk_schema = require('./zk_schema');

function process_meta_event(e,data){
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
            e.hour = data.d[0];
            e.minutes = data.d[1];
            e.seconds = data.d[2];
            e.frames = data.d[3];
            e.subframes = data.d[4];
        break;
        case Consts.events.subtypes.meta.TIME_SIGNATURE:
        case Consts.events.subtypes.meta.SEQUENCER_SPECIFIC:
            e.data = [...data.d];
        break;
        case Consts.events.subtypes.meta.KEY_SIGNATURE:
            e.key = data.key;
            e.min = data.min;
        break;
        default: break;
    }
    return true;
}

function process_midi_event(e,data){
    if(e.type != Consts.events.types.MIDI) return;
    e.channel = data.c;
    e.params = [...data.p];
    return true;
}

function process_midi_system_event(e,data){
    if(
        e.type != Consts.events.types.SYSEX
        && e.type != Consts.events.types.ESCAPE
    ) return;
    e.data = [...data.d];
    if(e.type == Consts.events.types.SYSEX) e.data.push(0xf7);
    return true;
}

function process_event(e,d){
    let s;
    if(s = process_meta_event(e,d)) return;
    if(s = process_midi_event(e,d)) return;
    if(s = process_midi_system_event(e,d)) return;
}

module.exports = class ZKFile{
    constructor(data,strict = false){
        let zk = this.zk = BinaryXML.to_parsed_xml(data);
        //if(strict && validator.validate(zk,zk_schema)) throw new TypeError('Validation failed');
        
        // 우선 다루기 편하게 변환
        /*let { elements:[{
            attributes:header
        },global_el,data_el] } = zk;*/
        
        let { elements:zk_els } = zk;
        let zk_el = zk_els.filter(el => {
            return el.type == 'element' && el.name == 'zk';
        })[0];
        if(!zk_el) throw new Error('there is no "zk" element');
        let header = zk_el.elements.filter(el => {
            return el.type == 'element' && el.name == 'header';
        });
        if(!header.length) throw new Error('there is no "header" element'); 
        header = header[0].elements.filter(el => {
            return el.type == 'element' && el.name == 'midi';
        });
        if(!header.length) throw new Error('there is no "midi" element in the "header" element');
        header = header[0].attributes;
        
        let mididata_el = zk_el.elements.filter(el => {
            return el.type == 'element' && el.name == 'mididata';
        })[0];
        if(!mididata_el) throw new Error('there is no "mididata" element');
        
        let global_el = mididata_el.elements.filter(el => {
            return el.type == 'element' && el.name == 'global';
        })[0];
        if(!global_el) throw new Error('there is no "global" element');
        
        let global = {
            meta:(() => {
                let d = {};
                for(let i in global_el.attributes){
                    if(!i.startsWith('meta:')) continue;
                    d[i.slice(5).replace(/-/g,'_')] = global_el.attributes[i];
                };
                return d;
            })(),
            events:global_el.elements.filter(el => {
                return el.type == 'element' && el.name == 'e';
            }).map(event_el => {
                // data 처리
                let data = {};
                event_el.elements.filter(el => {
                    return el.type == 'element' && el.name == 'd';
                }).forEach(d => {
                    for(let i in d.attributes){
                        data[i] = d.attributes[i];
                    }
                });

                return {
                    delta:event_el.attributes.dt,
                    type:event_el.attributes.t,
                    subtype:event_el.attributes.st,
                    data_obj:data
                };
            })
        };
        
        let data_el = mididata_el.elements.filter(el => {
            return el.type == 'element' && el.name == 'data';
        })[0];
        if(!data_el) throw new Error('there is no "data" element');
        let blocks = data_el.elements.filter(el => {
            return el.type == 'element' && el.name == 'block';
        }).map(block => {
            return block.elements.filter(el => {
                return el.type == 'element' && el.name == 'track';
            }).map(track => {
                return {
                    meta:(() => {
                        let d = {};
                        for(let i in global_el.attributes){
                            if(!i.startsWith('meta:')) continue;
                            d[i.slice(5).replace(/-/g,'_')] = global_el.attributes[i];
                        };
                        return d;
                    })(),
                    events:track.elements.filter(el => {
                        return el.type == 'element' && el.name == 'e';
                    }).map(event_el => {
                        // data 처리
                        let data = {};
                        event_el.elements.filter(el => {
                            return el.type == 'element' && el.name == 'd';
                        }).forEach(d => {
                            for(let i in d.attributes){
                                data[i] = d.attributes[i];
                            }
                        });
    
                        return {
                            delta:event_el.attributes.dt,
                            type:event_el.attributes.t,
                            subtype:event_el.attributes.st,
                            data_obj:data
                        };
                    })
                }
            });
        });
        //fs.writeFileSync('./json.json',JSON.stringify(blocks,0,3));
        //console.log(blocks.length);
        
        // 헤더 처리
        this.header = {
            format:1,
            ticks_per_beat:null,
            tick_resolution:null
        };
        
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
        this.global_events = new MidiTrack(global.meta);
        this.tempo_events = new MidiTrack(global.meta);
        let global_playtick = 0;
        let global_playms = 0;
        let current_tempo_us = 500000;
        global.events.forEach(event => {
            global_playtick += event.delta;
            
            // smtpe 방식의 파일에서는 자동적으로 NaN이 됨
            let reso = this.header.ticks_per_beat ? (current_tempo_us / this.header.ticks_per_beat) : this.header.tick_resolution;
            global_playms += (reso * event.delta)/1000;
            if(event.type != Consts.events.types.META){
                if(strict) throw new TypeError('midi/sysex/escape events cannot be global events');
                return;
            }
            let e = {
                ...event,
                playms:global_playms
            };
            process_meta_event(e,event.data_obj);
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
        blocks.forEach(data => {
            let tracks = [];
            data.forEach((trackdata,i) => {
                let track = new MidiTrack(i,trackdata.meta);
                let playtick = 0;
                trackdata.events.forEach(event => {
                    playtick += event.delta;
                    let e = {...event};
                    process_event(e,event.data_obj);
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
            this.header.duration_ms += Math.round(last_tempo*(ticks/this.header.ticks_per_beat)/1000)+DURATION_TAIL_MS;
            this.header.duration_tick += Math.round(DURATION_TAIL_MS*1000/last_tempo*this.header.ticks_per_beat);
        }else{
            this.header.duration_ms += Math.round(ticks*this.header.tick_resolution)+DURATION_TAIL_MS;
            this.header.duration_tick += Math.round(DURATION_TAIL_MS*1000/this.header.tick_resolution);
        }
    }
}