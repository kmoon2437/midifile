const MidiFile = require('./MidiFile');
const Consts = require('./Consts');
const { BinaryXML } = require('zxe-binaryxml');

function trackname2portnum(name){
    if(!name) return 0;
    let is_num = false;
    let numstr = '';
    for(let c of name){
        if(isNaN(Number(c))){
            if(is_num) return (isNaN(parseInt(numstr,10)) ? 1 : parseInt(numstr,10)) - 1;
            continue;
        }
        is_num = true;
        numstr += c;
    }
    return 0;
}

function new_meta_event(dt,st,data = {}){
    let event = {
        dt,t:Consts.events.types.META,st
    };
    if(data instanceof Array){
        event.d = {
            d:Buffer.from(data)
        };
    }else{
        event.d = {...data};
    }
    return event;
}

function new_midi_event(dt,st,c,p1,p2){
    return {
        dt,t:Consts.events.types.MIDI,st,
        d:{
            c,p:Buffer.from([p1,p2])
        }
    };
}

function new_sysex_event(dt,bytes){
    bytes.pop();
    return {
        dt,t:Consts.events.types.SYSEX,
        d:{ d:Buffer.from(bytes) }
    };
}

function new_escape_event(dt,bytes){
    return {
        dt,t:Consts.events.types.ESCAPE,
        d:{ d:Buffer.from(bytes) }
    };
}

module.exports = class ZKFileConverter{
    static midi2zk(midi_buf,compress = 'raw'){
        let file = new MidiFile(midi_buf);

        let header = {
            divtype:file.header.ticks_per_beat ? 'tpb' : 'smtpe',
            div0:file.header.ticks_per_beat || file.header.frames_per_second,
            div1:file.header.ticks_per_beat ? undefined : file.header.ticks_per_frame
        };
        if(typeof header.div1 == 'undefined'){
            delete header.div1;
        }

        let global_events = [];
        let global = {
            meta:{},events:[]
        };
        let blocks = [];
        //let last_delta = 0;
        if(file.header.format != 1) throw new TypeError('Only format 1 is supported');
        file.tracks.forEach(track => {
            let events_o = track.get_events();
            let events = [];
            for(let i in events_o){
                let arr = [...events_o[i]];
                arr.forEach(obj => {
                    obj.PLAYTICK = i;
                    events.push(obj);
                });
            }
            events = events.sort((a,b) => a.PLAYTICK - b.PLAYTICK);
            let track_events = [];
            let track2 = {
                meta:{},events:[]
            };
            events.forEach(event => {
                if(event.type == Consts.events.types.META){
                    switch(event.subtype){
                        case Consts.events.subtypes.meta.COPYRIGHT_NOTICE:
                            global.meta.copyright_notice = Buffer.from(event.data).toString('utf8');
                        break;
                        case Consts.events.subtypes.meta.TRACK_NAME:
                            track2.meta.track_name = Buffer.from(event.data).toString('utf8');
                        break;
                        case Consts.events.subtypes.meta.INSTRUMENT_NAME:
                            track2.meta.instrument_name = Buffer.from(event.data).toString('utf8');
                        break;
                        case Consts.events.subtypes.meta.LYRICS:
                        case Consts.events.subtypes.meta.SET_TEMPO:
                        case Consts.events.subtypes.meta.SMTPE_OFFSET:
                        case Consts.events.subtypes.meta.TIME_SIGNATURE:
                        case Consts.events.subtypes.meta.KEY_SIGNATURE:
                            global_events.push(event);
                        break;
                        /**
                        case Consts.events.subtypes.meta.SEQUENCE_NUMBER:
                        case Consts.events.subtypes.meta.TEXT:
                        case Consts.events.subtypes.meta.MARKER:
                        case Consts.events.subtypes.meta.CUE_POINT:
                        case Consts.events.subtypes.meta.CHANNEL_PREFIX:
                        case Consts.events.subtypes.meta.END_OF_TRACK:
                        case Consts.events.subtypes.meta.SEQUENCER_SPECIFIC:
                         */
                        default:
                            track_events.push(event);
                        break;
                    }
                }else{
                    track_events.push(event);
                }
            });

            /**
             * delta time 방식으로 변환
             */
            track_events.forEach((event,i) => {
                let dt = parseInt(track_events[i-1] ? event.PLAYTICK-track_events[i-1].PLAYTICK : event.PLAYTICK,10);
                if(event.type == Consts.events.types.META){
                    switch(event.subtype){
                        case Consts.events.subtypes.meta.SEQUENCE_NUMBER:
                            track2.events.push(new_meta_event(dt,event.subtype,{
                                msb:event.msb,
                                lsb:event.lsb
                            }));
                        break;
                        case Consts.events.subtypes.meta.TEXT:
                        case Consts.events.subtypes.meta.MARKER:
                        case Consts.events.subtypes.meta.CUE_POINT:
                            track2.events.push(new_meta_event(dt,event.subtype,{
                                txt:Buffer.from(event.data).toString('utf8')
                            }));
                        break;
                        case Consts.events.subtypes.meta.CHANNEL_PREFIX:
                            track2.events.push(new_meta_event(dt,event.subtype,{
                                prefix:event.prefix
                            }));
                        break;
                        case Consts.events.subtypes.meta.END_OF_TRACK:
                            track2.events.push(new_meta_event(dt,event.subtype));
                        break;
                        case Consts.events.subtypes.meta.SEQUENCER_SPECIFIC:
                            track2.events.push(new_meta_event(dt,event.subtype,event.data));
                        break;
                    }
                }else if(event.type == Consts.events.types.MIDI){
                    track2.events.push(new_midi_event(dt,event.subtype,event.channel,...event.params));
                }else if(event.type == Consts.events.types.SYSEX){
                    track2.events.push(new_sysex_event(dt,event.data));
                }else if(event.type == Consts.events.types.ESCAPE){
                    track2.events.push(new_escape_event(dt,event.data));
                }
            });

            let portnum = trackname2portnum(track2.meta.track_name);
            //console.log(track2.meta.track_name,portnum);
            if(!blocks[portnum]) blocks[portnum] = [];
            blocks[portnum].push(track2);
        });

        global_events.forEach((event,i) => {
            let dt = parseInt(global_events[i-1] ? event.PLAYTICK-global_events[i-1].PLAYTICK : event.PLAYTICK,10);
            if(event.type == Consts.events.types.META){
                switch(event.subtype){
                    case Consts.events.subtypes.meta.LYRICS:
                        global.events.push(new_meta_event(dt,event.subtype,{
                            txt:Buffer.from(event.data).toString('utf8')
                        }));
                    break;
                    case Consts.events.subtypes.meta.SET_TEMPO:
                        global.events.push(new_meta_event(dt,event.subtype,{
                            type:'microsec',
                            tempo:event.tempo
                        }));
                    break;
                    case Consts.events.subtypes.meta.SMTPE_OFFSET:
                        global.events.push(new_meta_event(dt,event.subtype,[
                            event.hour,
                            event.minutes,
                            event.seconds,
                            event.frames,
                            event.subframes
                        ]));
                    break;
                    case Consts.events.subtypes.meta.TIME_SIGNATURE:{
                        global.events.push(new_meta_event(dt,event.subtype,event.data));
                    }break;
                    case Consts.events.subtypes.meta.KEY_SIGNATURE:
                        global.events.push(new_meta_event(dt,event.subtype,{
                            key:event.key,
                            min:!event.scale
                        }));
                    break;
                }
            }/*else if(event.type == Consts.events.types.MIDI){
                track_data.push(new_midi_event(dt,event.subtype,event.channel,...event.params));
            }else if(event.type == Consts.events.types.SYSEX){
                track_data.push(new_sysex_event(dt,event.data));
            }else if(event.type == Consts.events.types.ESCAPE){
                track_data.push(new_escape_event(dt,event.data));
            }*/
        });

        /*let json = {
            header:{
                midi:header,
            },
            midi:{
                global,data:blocks
            }
        };*/
        
        let zk = {
            type:'element',
            name:'zk',
            elements:[]
        };
        
        // 헤더
        zk.elements.push({
            type:'element',
            name:'header',
            elements:[{
                type:'element',
                name:'midi',
                attributes:header
            }]
        });

        let global_el = {
            type:'element',
            name:'global',
            attributes:{},
            elements:[]
        };
        for(let i in global.meta){
            global_el.attributes['meta:'+i.replace(/_/g,'-')] = global.meta[i];
        }
        for(let event of global.events){
            global_el.elements.push({
                type:'element',
                name:'e',
                attributes:{
                    dt:event.dt,
                    t:event.t,
                    st:event.st
                },
                elements:[{
                    type:'element',
                    name:'d',
                    attributes:event.d
                }]
            });
        }
        
        let data_el = {
            type:'element',
            name:'data',
            elements:[]
        };
        for(let block of blocks){
            let block_el = {
                type:'element',
                name:'block',
                elements:[]
            };
            for(let track of block){
                let track_el = {
                    type:'element',
                    name:'track',
                    attributes:{},
                    elements:[]
                };
                for(let i in track.meta){
                    track_el.attributes['meta:'+i.replace(/_/g,'-')] = track.meta[i];
                }
                for(let event of track.events){
                    track_el.elements.push({
                        type:'element',
                        name:'e',
                        attributes:{
                            dt:event.dt,
                            t:event.t,
                            st:event.st
                        },
                        elements:[{
                            type:'element',
                            name:'d',
                            attributes:event.d
                        }]
                    });
                }
                block_el.elements.push(track_el);
            }
            data_el.elements.push(block_el);
        }
        
        let mididata_el = {
            type:'element',
            name:'mididata',
            elements:[global_el,data_el]
        };
        
        zk.elements.push(mididata_el);
        
        let xml = {
            declaration:{ attributes:{
                version:'1.0',
                encoding:'utf-8'
            } },
            elements:[zk]
        };
        
        return BinaryXML.from_parsed_xml(xml,{ compress });
        //return Buffer.from(JSON.stringify(json,0,4),'utf8');
    }
}