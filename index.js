var util = require("util");
var EventEmitter = require("events").EventEmitter;

module.exports = SSTStateMachine = function(opt){
	var next = [];
	
	opt = opt || {};
	
	if (!(this instanceof SSTStateMachine))
		return new SSTStateMachine(opt);
	
	// there must be some states
	if (opt.states)
		this.states = opt.states;
	if (typeof(this.states) !== "object")
		throw new Error("This SSTStateMachine instance does not have a valid states hash");
	
	// get array of states
	this.stateList = [];
	for (var k in this.states)
		this.stateList.push(k);
	
	// get hash of state types
	this.stateTypes = {};
	for (var k in this.states){
		if (typeof(this.states[k].type) === "string"){
			this.stateTypes[this.states[k].type] = this.stateTypes[this.states[k].type] || [];
			this.stateTypes[this.states[k].type].push(k);
		}
		else if (util.isArray(this.states[k].type)){
			for (var i=0; i<this.states[k].type.length; i++){
				this.stateTypes[this.states[k].type[i]] = this.stateTypes[this.states[k].type[i]] || [];
				this.stateTypes[this.states[k].type[i]].push(k);
			}
		}
	}
	
	// validate next properties
	for (var k in this.states){
		if (util.isArray(this.states[k].next)){
			next = [];
			
			for (var i=0; i<this.states[k].next.length; i++){
				if (this.states[this.states[k].next[i]] !== undefined)
					next.push(this.states[k].next[i]);
				else if (this.stateTypes[this.states[k].next[i]] !== undefined)
					this.stateTypes[this.states[k].next[i]].forEach(function(n){ if (next.indexOf(n)===-1) next.push(n); });
				else
					throw new Error("SSTStateMachine state ["+k+"] includes invalid next state or type ["+this.states[k].next[i]+"]");
			}
			
			this.states[k].next = next;
		}
		else{
			this.states[k].next = this.states[k].next || [];
		}
	}
	
	// process defaults by default
	for (var k in this.states){
		if (this.states[k].defaults !== undefined && this.states[k].preprocess === undefined){
			this.states[k].preprocess = this.processDefaults;
		}
	}
	
	// there must be a start state
	if (opt.startState)
		this.startState = opt.startState;
	else if (this.stateList.filter(function(s){ return s.startState; }).length)
		this.startState = this.states.filter(function(s){ return s.startState; })[0].name;
	if (this.startState === undefined)
		throw new Error("This SSTStateMachine instance does not have a start state");
	else if (this.states[this.startState] === undefined)
		throw new Error("Provided startState ["+this.startState+"] is not a valid state");
	
	// set text
	if (opt.text)
		this.text = opt.text;
	
	EventEmitter.call(this,opt);
};
util.inherits(SSTStateMachine,EventEmitter);

SSTStateMachine.prototype.process = function(text,meta){
	var nextstate = {};
	
	if (text)
		this.text = text;
	
	this.state = this.startState;
	this.meta = meta;
	this.textRemaining = this.text;
	this.stateHistory = [];
	
	while (null !== (nextstate = this.getNextState())){
		// exit previous state
		this.emit("exit",this.state,this.stateInfo);
		
		// add meta information to item
		if (this.meta)
			nextstate.meta = this.meta;
		
		// preprocessing of new state information
		if (typeof(this.states[nextstate.state].preprocess) === "function")
			this.states[nextstate.state].preprocess.call(this,nextstate);
		
		// callback
		if (this.states[nextstate.state].callback !== undefined)
			this.states[nextstate.state].callback.call(this,nextstate);
		
		// enter new state
		this.state = nextstate.state;
		this.stateInfo = nextstate;
		this.textRemaining = this.textRemaining.slice(this.stateInfo.index + this.stateInfo.matches[0].length);
		if (this.stateInfo.index > 0){
			this.stateHistory.push({
				state : "no-state",
				text : this.textRemaining.slice(0,this.stateInfo.index)
			});
		}
		this.emit("enter",this.state,this.stateInfo);
		
		// add result to history
		this.stateHistory.push(nextstate);
	}
	
	this.emit("done",this.stateHistory);
}

SSTStateMachine.prototype.getNextState = function(){
	var next = this.states[this.state].next, indexes = [], thisstate = {};
	
	// next can be an array of state names or a function that returns such an array
	if (typeof(next) === "function")
		next = next.call(this);
	
	for (var i=0; i<next.length; i++){
		thisstate = this.states[next[i]];
		
		if (thisstate.test instanceof RegExp){
			// regular expression test
			indexes.push({ 
				state : next[i], 
				index : this.textRemaining.search(thisstate.test), 
				seq : i,
				matches : thisstate.test.exec(this.textRemaining) 
			});
		}
		else if (typeof(thisstate.test) === "function"){
			// function test - must return hash containing state, index, seq, and matches containing at least one matching group
			indexes.push(thisstate.test.call(this,next[i],i) || { state : next[i], index : -1, seq : i, matches : {} });
		}
	}
	
	// remove non-matching states, and sort by soonest match first
	indexes = indexes.filter(function(m){
		return m.index !== undefined && m.index > -1;
	}).sort(function(a,b){
		if (a.index === b.index)
			return a.seq - b.seq;
		else
			return a.index - b.index;
	});
	
	return indexes.length ? indexes[0] : null;
}

SSTStateMachine.prototype.processDefaults = function processDefaults(info){
	var thisstate = this.states[info.state], tmp = {};
	
	if (thisstate.defaults === undefined)
		return;
	
	if (util.isArray(thisstate.defaults)){
		info.results = info.results || [];
		
		for (var i=0; i<thisstate.defaults.length; i++){
			tmp = {};
			
			for (var k in thisstate.defaults[i]){
				if (info.matches && info.matches.captures && info.matches.captures[k] && info.matches.captures[k].length)
					tmp[k] = info.matches.captures[k][0];
				else
					tmp[k] = thisstate.defaults[i][k];
			}
			
			info.results.push(tmp);
		}
	}
	else{
		info.results = info.results || {};
		
		for (var k in thisstate.defaults){
			if (info.matches && info.matches.captures && info.matches.captures[k] && info.matches.captures[k].length)
				info.results[k] = info.matches.captures[k][0];
			else
				info.results[k] = thisstate.defaults[k];
		}
	}
}