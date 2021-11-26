module.exports = class MidiTrack{
    constructor(track_no,meta){
        this.track_no = track_no;
        this.meta = meta;
        this.events = {};
    }
    
    add_event(time,event){
        if(!this.events[time]) this.events[time] = [];
        this.events[time].push(event);
    }

    get_events(){
        return this.events;
    }
}