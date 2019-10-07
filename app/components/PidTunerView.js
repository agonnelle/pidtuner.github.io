// get current file URL
var scripts = document.getElementsByTagName("script");
var src     = scripts[scripts.length-1].src;
var listUrl = src.split('/');
listUrl.pop();
listUrl.push("");
var scriptPidTunerViewDir = listUrl.join("/");

getPidTunerViewComponent = async function() {
// ------------------------------------------------------------------------

// get dependencies
var ImportDataView  = await getImportDataViewComponent();
var SelectStepView  = await getSelectStepViewComponent();
var SelectModelView = await getSelectModelViewComponent();
var TunePidView     = await getTunePidViewComponent();

// get template for component
var templPidTunerView;
await $.asyncGet(scriptPidTunerViewDir + "PidTunerView.html", function(data){
    templPidTunerView = data;
}.bind(this));

var PidTunerView = {
  template: templPidTunerView,
  props: {
    classes: {
      type    : Array,
      required: false
    },
  },
  data() {
    return {
        // array to be able to iterate for left menu creation
      proj_id             : 0,
      all_steps           : ['import_data','select_step','select_model','tune_pid'],
        // states used for work-flow, enable/disable menu items, etc.
      current_step        : "import_data",
      latest_step         : "import_data",
      show_message        : true,
      next_enabled        : false,
      step_loaded         : false,
        // step 1 result. import_data
      time                : [],
      input               : [],
      output              : [],
        // step 2 result. select step
      cached_range_list   : [],
      selected_range      : [],
      uniform_time        : [],
      uniform_input       : [],
      uniform_output      : [],
        // step 3 result. select model
      cached_model_list   : [],
      selected_model      : {},
      // step 4 result    : tune pid
      cached_gains_slider : 0,
      cached_time_slider  : 0,
      cached_r_size       : 1.0,
      cached_d_size       : 0.0,
      pid_gains           : [],
      pidsim_time         : [],
      pidsim_input        : [],
      pidsim_output       : [],
      pidsim_ref          : [],
      pidsim_dist         : [],
      margins             : [],
      bode_w              : [],
	  bode_mag            : [],
	  bode_pha            : [],
    }
  },
  beforeMount: function() {
  	// [UNDO] global event listeners
  	// TODO : child components not ready for UNDO

	window.addEventListener('keyup', (e) => {
		var evtobj = window.event? event : e
      	if (evtobj.keyCode == 90 && evtobj.ctrlKey) {
      		this.undo();
      	}
      	else if (evtobj.keyCode == 89 && evtobj.ctrlKey) {
      		this.redo();
      	}
	});

    // create steps info
    this.stepInfo = {};
    this.stepInfo['import_data' ] = {
      num   : 1,
      comp  : 'v-import-data',
      title : 'Import Data',
      icon  : 'table icon',
      info  : `
      Import your <a href="https://en.wikipedia.org/wiki/Step_response" target="_blank">step response data</a> here. 
      Copy and paste to the table below using the ctrl+v shortcut. 
      Match each column of the table with the corresponding data. 
      All three columns must be of the same length. 
      A minimum of 50 samples is required.
      Right click over the table headers or rows to get a context menu.
      `
    };
    this.stepInfo['select_step' ] = {
      num   : 2,
      comp  : 'v-select-step',
      title : 'Select Step',
      icon  : 'share square icon',
      info  : `
      The step response data might contain multiple steps,
      but for tuning purposes, only one step is needed.
      Please select the smallest time range, where only one step response data is contained.
      It is possible to define custom ranges by dragging the vertical lines.
      `
    };
    this.stepInfo['select_model'] = {
      num   : 3,
      comp  : 'v-select-model',
      title : 'Select Model',
      icon  : 'sitemap icon',
      info  : `
      The model type that best fits the step response data is automatically selected.
      Nevertheless, it is possible to select a different model if it is known that the process
      belongs to a different system class. Please select the preferred model.
      `
    };
    this.stepInfo['tune_pid'    ] = {
      num   : 4,
      comp  : 'v-tune-pid',
      title : 'Tune PID',
      icon  : 'sliders horizontal icon',
      info  : `
      These PID gains provide a starting point for tuning your PID.
      Feel free to change the PID gains as desired and see the resulting step 
      and disturbance response changing in real time.
      Press Enter after changing a value to update the simulation. 
      The PID implementation used in the simulation is the 
      <a href="https://en.wikipedia.org/wiki/PID_controller#Discrete_implementation" target="_blank">
		velocity algorithm
      </a> 
      in the 
      <a href="https://en.wikipedia.org/wiki/PID_controller#Ideal_versus_standard_PID_form" target="_blank">
		standard form
      </a>.
      `
    };
    // create dixie db 
    this.db = new Dexie("pidtuner");
    this.db.version(2).stores({
	  projdata: `proj_id,all_steps,current_step,latest_step,show_message,next_enabled,step_loaded,time,input,output,cached_range_list,selected_range,uniform_time,uniform_input,uniform_output,cached_model_list,selected_model,cached_gains_slider,cached_time_slider,cached_r_size,cached_d_size,pid_gains,pidsim_time,pidsim_input,pidsim_output,pidsim_ref,pidsim_dist,margins,bode_w,bode_mag,bode_pha`
	}).upgrade (tx => {
		return tx.projdata.toCollection().modify (data => {
			if (!data.margins ) { data.margins  = [] }
			if (!data.bode_w  ) { data.bode_w   = [] }
			if (!data.bode_mag) { data.bode_mag = [] }
			if (!data.bode_pha) { data.bode_pha = [] }
		});
	});
	this.db.version(1).stores({
	  projdata: `proj_id,all_steps,current_step,latest_step,show_message,next_enabled,step_loaded,time,input,output,cached_range_list,selected_range,uniform_time,uniform_input,uniform_output,cached_model_list,selected_model,cached_gains_slider,cached_time_slider,cached_r_size,cached_d_size,pid_gains,pidsim_time,pidsim_input,pidsim_output,pidsim_ref,pidsim_dist`
	});  
	// create method to reuse
	this.getDbObj = () => {
		return this.db.projdata.where("proj_id").equals(0);
	};
	// try to load if any
	this.getDbObj().first().then((data) => {
			const dataKeys = Object.keys(this.$data);
			if(data) {
				// load vue data
				for(var i = 0; i < dataKeys.length; i++) {
					const currKey = dataKeys[i];
					this[currKey] = data[currKey];
				}
			}
			else {
				// add it for the first time
				this.createDbEntry();
			}
			// subscribe to changes
			for(var i = 0; i < dataKeys.length; i++) {
				const currKey = dataKeys[i];
				// subscribe to each key in data
				this.$watch(currKey, (value) => {
					// update key in IndexedDb
					this.updateDbEntry(currKey, value);
				}, {
					deep: true
				});
			}
		})
		.catch((err) => {
			console.warn(err);
		}); 
  },
  mounted: function() {
    // setup close button for info
    $(this.$refs.close_button).on('click', function() {
      $(this).closest('.message').transition('fade') ;
    }).on('click', () => {
      setTimeout(() => {
        this.show_message = false;
      }, 300);
    });       
  },
  methods: {
  	// create initial (one time) db entry
  	createDbEntry : function() {
  		this.db.projdata.add(this.$data).then(() => {
			console.info("Project data being saved in memory from now on");
		})
		.catch((err) => {
			console.warn(err);
		});  
  	},
  	updateDbEntry : function(key, val) {
		// create cache if not exists
  		if(!this.update_db_cache) {
  			this.update_db_cache = {};
  		}
  		// add undo value to cache 
  		this.update_db_cache[key] = val;
  		// create throttle func if not exists
  		if(!this.throttle_updateDbEntry) {
			this.throttle_updateDbEntry = throttle(() => {
				// update stored state in IndexedDb
				this.getDbObj().modify((dbObj) => {
					// get keys to update in db 
					var dbKeys = Object.keys(this.update_db_cache);
					for(var i = 0; i < dbKeys.length; i++) {
						const dbKey = dbKeys[i];
						const dbVal = this.update_db_cache[dbKey];
						// ignore if not changed (to avoid feedback in undo stack)
						if(dbObj[dbKey] == dbVal ||
						   (typeof dbObj[dbKey].isEqual == "function" && dbObj[dbKey].isEqual(dbVal)) || // if array
						   (typeof dbObj[dbKey].isEqual == "undefined" && Object.isObjEqual(dbObj[dbKey], dbVal) && typeof dbVal != "number") // if object
						  ) {
							continue;
						}
						// [UNDO] push old value to undo stack before updating
						// TODO : child components not ready for UNDO

						this.addUndo(dbKey, dbObj[dbKey]);
						
						// update IndexedDb value
						dbObj[dbKey] = dbVal;				
					}
					// clean cache
					this.update_db_cache = {};
				});					
			}, 200, { leading : false });
  		}
  		// call 
  		this.throttle_updateDbEntry();	
  	},
    // check if should disable
    isStepDisabled: function(stepName) {
      return this.stepInfo[stepName].num > this.stepInfo[this.latest_step].num;
    },
    // get step number
    getNumber: function(stepName) {
      return this.stepInfo[stepName].num;
    },
    // get step component
    getComponent: function(stepName) {
      return this.stepInfo[stepName].comp;
    },
    // get step title
    getTitle: function(stepName) {
      return this.stepInfo[stepName].title;
    },
    // get step icon
    getIcon: function(stepName) {
      return this.stepInfo[stepName].icon;
    },
    // get step information
    getInfo: function(stepName) {
      return this.stepInfo[stepName].info;
    },
    // get next step
    getNextStep: function(stepName) {
      // NOTE : getNumber returns index+1, so index of next step
      var stepNum = this.getNumber(stepName);
      return this.all_steps[stepNum];
    },
    // get previous step
    getPrevStep: function(stepName) {
      // NOTE : getNumber returns index+1, so index of next step
      var stepNum = this.getNumber(stepName);
      return this.all_steps[stepNum-2];
    },
    on_backClicked() {
    	this.step_loaded  = false; 
    	Vue.nextTick( () => { 
			this.current_step = this.getPrevStep(this.current_step); 
			this.next_enabled = true;	
    	} );
    },
    on_nextClicked() {
    	this.step_loaded = false; 
    	Vue.nextTick( () => { 
    		this.current_step = this.getNextStep(this.current_step); 
    		if(this.getNumber(this.latest_step) < this.getNumber(this.current_step)) {
    			this.latest_step  = this.current_step; 
    		}		
    		this.next_enabled = false; 
		} );
    },
    resetStep2() {
	  this.cached_range_list.splice(0, this.cached_range_list.length);
	  this.selected_range   .splice(0, this.selected_range   .length);
	  this.uniform_time     .splice(0, this.uniform_time     .length);
	  this.uniform_input    .splice(0, this.uniform_input    .length);
	  this.uniform_output   .splice(0, this.uniform_output   .length);    	
    },
    resetStep3() {
	  this.cached_model_list.splice(0, this.cached_model_list.length);
	  this.selected_model = {};	  
    },
    resetStep4() {
      this.cached_gains_slider = 0;
      this.cached_time_slider  = 0;  
      this.cached_r_size       = 1.0;
      this.cached_d_size       = 0.0;
      this.pid_gains.splice(0, this.pid_gains.length);
      this.pidsim_time  .splice(0, this.pidsim_time  .length);      
      this.pidsim_input .splice(0, this.pidsim_input .length);
      this.pidsim_output.splice(0, this.pidsim_output.length);
      this.pidsim_ref   .splice(0, this.pidsim_ref   .length);      
      this.pidsim_dist  .splice(0, this.pidsim_dist  .length);      
    },
    addUndo : function(key, valOld) {
    	// [UNDO] 
  		// create cache if not exists
  		if(!this.undo_stack_cache) {
  			this.undo_stack_cache = {};
  		}
  		// add undo value to cache 
  		this.undo_stack_cache[key] = valOld;
  		// NOTE : save step state until next state initial variables loaded, because there are delays involved
		if(key == 'current_step') { return; }
		if(key == 'latest_step' ) { return; }
		// NOTE : save sliders cache until simulation updated, because there are delays involved
		if(key == 'cached_gains_slider') { return; }
		if(key == 'cached_time_slider' ) { return; }
  		// create throttle func if not exists
  		if(!this.throttle_addUndo) {
			this.throttle_addUndo = throttle(() => {
				// add cache to undo stack
				this.undo_stack.push(this.undo_stack_cache);	
				// clear cache
				this.undo_stack_cache = {};
				// clear redo 
				this.redo_stack.splice(0, this.redo_stack.length);				
			}, 200, { leading : false });
  		}
  		// call 
  		this.throttle_addUndo();		
  	},
    undo() {
    	// [UNDO] 
    	// nothing to do here
    	if(this.undo_stack.length <= 0) {
    		return;
    	}
    	// loop keys to undo 
    	var undoObj  = this.undo_stack.pop();
    	var undoKeys = Object.keys(undoObj);	
		// set first in IndexedDb to avoid loop
		this.getDbObj().modify((db_obj) => {
			var redoObj = {};
			for(var i = 0; i < undoKeys.length; i++) {
				const undoKey = undoKeys[i];			
				// update IndexedDb
				db_obj[undoKey] = undoObj[undoKey];
				// copy to redo before overwrite
				redoObj[undoKey] = this[undoKey];
				// update Vue data later
				this.$nextTick(() => {
					this[undoKey] = undoObj[undoKey];
				});
			}
			// add to redo stack
			this.redo_stack.push(redoObj);
		});
    },
    redo() {
    	// [UNDO] 
    	// nothing to do here
    	if(this.redo_stack.length <= 0) {
    		return;
    	}
    	// loop keys to redo 
    	var redoObj  = this.redo_stack.pop();
    	var redoKeys = Object.keys(redoObj);	
		// set first in IndexedDb to avoid loop
		this.getDbObj().modify((db_obj) => {
			var undoObj = {};
			for(var i = 0; i < redoKeys.length; i++) {
				const redoKey = redoKeys[i];			
				// update IndexedDb
				db_obj[redoKey] = redoObj[redoKey];
				// copy to undo before overwrite
				undoObj[redoKey] = this[redoKey];
				// update Vue data later
				this.$nextTick(() => {
					this[redoKey] = redoObj[redoKey];
				});
			}
			// add to undo stack
			this.undo_stack.push(undoObj);
		});   	
    }
  }, //methods
  computed: {
    undo_stack: {
		get: function() { 
			if(!this.internal_undo) {
				this.internal_undo = [];
			}
			return this.internal_undo;
		},
		set: function(val) {
			this.internal_undo = val;		
		}    
	},
	redo_stack: {
		get: function() { 
			if(!this.internal_redo) {
				this.internal_redo = [];
			}
			return this.internal_redo;
		},
		set: function(val) {
			this.internal_redo = val;		
		}    
	}
  },
  watch: {
	latest_step: function(){
		if(this.latest_step == 'import_data') {
		  this.resetStep2();
		  this.resetStep3();
          this.resetStep4();
		}
		else if(this.latest_step == 'select_step') {
          this.resetStep3();
          this.resetStep4();
		}
		else if(this.latest_step == 'select_model') {
          this.resetStep4();
		}
		else if(this.latest_step == 'tune_pid') {
          // nothing to do here
		}
	},
  },
  components: {
    'v-import-data'  : ImportDataView ,
    'v-select-step'  : SelectStepView ,
    'v-select-model' : SelectModelView,
    'v-tune-pid'     : TunePidView    ,
  }
};

// ------------------------------------------------------------------------
return PidTunerView;
}