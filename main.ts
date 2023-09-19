import { App, Editor, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting, View, moment } from 'obsidian';

// Remember to rename these classes and interfaces!

interface AIComPluginSettings {
	ai_url: string,
	ai_secret: string,
	system_prompt: string;
	top_k: number,
	top_p: number,
	temperature: number,
	repeat_penalty: number,
	user_name: string,
	token_speed: number
}

const DEFAULT_SETTINGS: Partial<AIComPluginSettings> = {
	ai_url: 'http://127.0.0.1:8080',
	ai_secret: '',
	system_prompt: 'You are the AI assistant. You talk with people and helps them.',
	top_k: 30,
	top_p: 0.9,
	temperature: 0.2,
	repeat_penalty: 1.1,
	user_name: 'User',
	token_speed: 100
}

export default class AIComPlugin extends Plugin {
	settings: AIComPluginSettings;
	statusBar: HTMLElement;
	editor: Editor;
	ribbonIcon: HTMLElement;
	ai_generation: string = 'stop';
	xhr: XMLHttpRequest;
	flooding: boolean = false;
	system_set: boolean = false;
	info_response: string = '';
	info_tokens: number = 0;
	
	set_ai(status){
		this.ai_generation = status;
		if (status.endsWith('-error')){
			this.editor = null;
			new Notice("AI conversation unset on error");
		}else if(status == 'stop'){
			this.editor = null;
		}else if(status == 'read'){
			this.flooding = false;
		}
		console.log('aicom:', status);
		this.updateStatusBar()
	}

	async onload() {
		await this.loadSettings();
        console.log('loading aicom');

		// This creates an icon in the left ribbon.
		this.ribbonIcon = this.addRibbonIcon('bot', 'AI Companion', (evt: MouseEvent) => {
			// Called when the user clicks the icon.
			const view = this.app.workspace.getActiveViewOfType(MarkdownView);
			if(view != null){
				if (this.editor == view.editor) {
					this.set_ai('pause')
					this.appendText("\n\n==User==\n");
					this.set_ai('stop');
					this.editor = null;
					new Notice("AICom unset");
				} else {
					this.set_ai('query');
					this.editor = view.editor;
					new Notice("AICom set");
					this.xhr = new XMLHttpRequest();
					this.xhr.timeout = 120000;
					this.xhr.responseType = 'text';
					this.xhr.aicom = this;
					this.xhr.onload = function() {
						console.log('onload', this.status);
						if (this.status != 200) {
							this.aicom.set_ai('s-error');
							new Notice(`AICom query error  ${this.status}: ${this.statusText}`);
						} else {
							this.aicom.info_response = this.response;
							this.aicom.info_tokens = 0;
							this.aicom.set_ai('read');
							this.aicom.appendText("\n\n==AICom==\n");
						}
					}
					this.xhr.ontimeout = function() {
						this.aicom.set_ai('t-error');
					}
					this.xhr.onerror = function(e) {
						//this.aicom.set_ai('x-error');
						console.log('AICom requerst error:', e);
					}
					this.xhr.open('POST', this.settings.ai_url+'/query');
					this.xhr.send(JSON.stringify(this.prepareContext()));
				}
			} else new Notice("AICom please select editor");
		});
	  	this.ai_generation = 'stop';
		// Perform additional things with the ribbon
		this.ribbonIcon.addClass('aicom-plugin-ribbon-class');

		// This adds a status bar item to the bottom of the app. Does not work on mobile apps.
		this.statusBar = this.addStatusBarItem();
		//statusBarItemEl.setText('Status Bar Text');

		this.updateStatusBar();

		// TODO: this fires everytime. It's quite cheap, but we should start and stop it
		this.registerInterval(
			window.setInterval(() => this.floodEditor(), 100)
		);

		// This adds a simple command that can be triggered anywhere
		this.addCommand({
			id: 'open-sample-modal-simple',
			name: 'Open sample modal (simple)',
			callback: () => {
				new SampleModal(this.app).open();
			}
		});
		// This adds an editor command that can perform some operation on the current editor instance
		this.addCommand({
			id: 'sample-editor-command',
			name: 'Sample editor command',
			editorCallback: (editor: Editor, view: MarkdownView) => {
				console.log(editor.getSelection());
				editor.replaceSelection('Sample Editor Command');
			}
		});
		// This adds a complex command that can check whether the current state of the app allows execution of the command
		this.addCommand({
			id: 'open-sample-modal-complex',
			name: 'Open sample modal (complex)',
			checkCallback: (checking: boolean) => {
				// Conditions to check
				const markdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
				if (markdownView) {
					// If checking is true, we're simply "checking" if the command can be run.
					// If checking is false, then we want to actually perform the operation.
					if (!checking) {
						new SampleModal(this.app).open();
					}

					// This command will only show up in Command Palette when the check function returns true
					return true;
				}
			}
		});

		// This adds a settings tab so the user can configure various aspects of the plugin
		this.addSettingTab(new AIComSettingTab(this.app, this));

		// If the plugin hooks up any global DOM events (on parts of the app that doesn't belong to this plugin)
		// Using this function will automatically remove the event listener when this plugin is disabled.
		this.registerDomEvent(document, 'click', (evt: MouseEvent) => {
			//console.log('click', evt);
		});

		// When registering intervals, this function will automatically clear the interval when the plugin is disabled.
		//this.registerInterval(window.setInterval(() => console.log('setInterval'), 5 * 60 * 1000));
	}

	updateStatusBar() {
		this.statusBar.setText(`AICom: ${this.ai_generation} ${this.info_response} ${this.info_tokens?this.info_tokens:''}`);
	}

	prepareContext() {
		function strip(str){
			return str.replace(/^\s+|\s+$/g, '');
		}
		let pos0 = {line: 0, ch: 0};
		let text = this.editor.getRange(pos0, this.editor.getCursor());
		// parse \n==Params|User|System|Bot==\ncontent\n
		let messages = [];
		let params = "";
		let message = "";
		let role = "";
		let state = "";
		let nl = true;
		let newblock = false;
		let system_used = false;
		let lines = text.split('\n');
		for(let k in lines){
			let line = lines[k];
			//console.log("ctx: ", line)
			if(nl){
				if(line == "==Params=="){
					state = 'params';
					params = '';
					newblock = true;
				}else if(line == "==System=="){
					if(message != '' && role != '')
						messages.push([role, strip(message)]);
					role = 'system';
					system_used = true;
					state = 'message';
					message = '';
					newblock = true;
				}else if(line == "==User=="){
					if(message != '' && role != '')
						messages.push([role, strip(message)]);
					role = 'user';
					state = 'message';
					message = '';
					newblock = true;
				}else if(line == "==AICom=="){
					if(message != '' && role != '')
						messages.push([role, strip(message)]);
					role = 'bot';
					state = 'message';
					message = '';
					newblock = true;
				}
			}
			if(!newblock){
				if(state == "params"){
					params += "\n"+line
				}else if(state == "message"){
					message += "\n"+line
				}
			}
			newblock = false;

			if(line == "") nl = true
			else nl = false;
		}
		if(message != '' && role != '')
			messages.push([role, strip(message)]);

		if(!system_used)
			messages.unshift(['system', this.settings.system_prompt]);

		params = strip(params);
		if(params == "") params={}; // TODO: in fact here is simply a bug

		console.log('sending request:', params, messages)

		return {params: params, messages: messages};
	}

	appendText(text: string) {
		if(this.editor == null) return;
		let cursor = this.editor.getCursor();
		this.editor.replaceRange(text, cursor);
		cursor.ch += text.length;
		this.editor.setCursor(cursor);
	}

	floodEditor() {
		if (!this.flooding && this.editor != null && this.ai_generation == 'read') {
			this.flooding = true;
			this.xhr.onload = function() {
				if (this.status != 200) { // анализируем HTTP-статус ответа, если статус не 200, то произошла ошибка
					this.aicom.set_ai('r-error');
					new Notice(`AI convesation receive error  ${this.status}: ${this.statusText}`);
				} else { // если всё прошло гладко, выводим результат
					let text = this.response;
					//console.log(text)
					if(text != ''){
						if(text == '[[END OF AICOM SENTENCE]]') {
							this.aicom.appendText("\n\n==User==\n");
							this.aicom.set_ai('stop');
						}else{
							this.aicom.appendText(text);
							this.aicom.info_tokens++;
							this.aicom.updateStatusBar();
						}
					}
				}
				this.aicom.flooding = false;
			}
			this.xhr.open('GET',this.settings.ai_url+'/receive');
			this.xhr.send();
	  	}
	}

	async onunload() {
        console.log('unloading aicom');
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

class SampleModal extends Modal {
	constructor(app: App) {
		super(app);
	}

	onOpen() {
		const {contentEl} = this;
		contentEl.setText('Woah!');
	}

	onClose() {
		const {contentEl} = this;
		contentEl.empty();
	}
}

class AIComSettingTab extends PluginSettingTab {
	plugin: AIComPlugin;

	constructor(app: App, plugin: AIComPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const {containerEl} = this;

		containerEl.empty();

		new Setting(containerEl)
			.setName('AI API url')
			.setDesc('')
			.addText(text => text
				.setPlaceholder('http://127.0.0.1:8080')
				.setValue(this.plugin.settings.ai_url)
				.onChange(async (value) => {
					this.plugin.settings.ai_url = value;
					await this.plugin.saveSettings();
				}));


		new Setting(containerEl)
			.setName('System prompt')
			.setDesc('The instructions about a conversation. You can override it by System section in particular dialog.')
			.addTextArea(text => text
				.setPlaceholder('You are the AI assistant. You talk with people and helps them.')
				.setValue(this.plugin.settings.system_prompt)
				.onChange(async (value) => {
					this.plugin.settings.system_prompt = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('User name')
			.setDesc('The representation of a user person in a dialog.')
			.addText(text => text
				.setPlaceholder('User')
				.setValue(this.plugin.settings.user_name)
				.onChange(async (value) => {
					this.plugin.settings.user_name = value;
					await this.plugin.saveSettings();
				}));
	}
}
