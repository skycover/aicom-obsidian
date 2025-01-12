import { App, Editor, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting, View, moment } from 'obsidian';

// Remember to rename these classes and interfaces!

interface AIComPluginSettings {
	ai_url: string,
	ai_key: string,
	system_prompt: string;
	top_k: number,
	top_p: number,
	temperature: number,
	repeat_penalty: number,
	user_name: string,
	token_speed: number
}

const DEFAULT_SETTINGS: Partial<AIComPluginSettings> = {
	ai_url: 'https://api.openai.com/v1',
	ai_key: '',
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
	flooding: boolean = false;
	system_set: boolean = false;
	info_response: string = '';
	info_tokens: number = 0;
	reader: ReadableStreamDefaultReader | null = null;
	
	set_ai(status:string){
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
					this.sendRequest();
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
			return str.replace(/^\s+$/g, ''); // only strip the end of line, not the start
		}
		let pos0 = {line: 0, ch: 0};
		let text = "";
		let selected = this.editor.somethingSelected();
		if( selected ){
			text = this.editor.getSelection();
			pos0 = this.editor.listSelections()[0].head;
			this.editor.setCursor(this.editor.getCursor("to"));
		}else{
			text = this.editor.getRange(pos0, this.editor.getCursor());
		}
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
					role = 'assistant';
					state = 'message';
					message = '';
					newblock = true;
				}
			}
			if(!newblock){
				if(state == "params"){
					params += (message==''?'':"\n")+line
				}else if(state == "message"){
					message += (message==''?'':"\n")+line
				}
			}
			newblock = false;

			if(line == "") nl = true
			else nl = false;
		}
		if(message != '' && role != '')
			messages.push([role, strip(message)]);

		if(messages.length == 0){
			if(! selected) this.prependText("==User==\n", pos0);
			messages.push(['user', text]);
		}

		if(!system_used)
			messages.unshift(['system', this.settings.system_prompt]);

		params = strip(params);
		if(params == "") params={}; // TODO: in fact here is simply a bug

		console.log('sending request:', params, messages)

		return {messages: messages.map(([role, content]) => ({role, content})), stream: true};
	}

	prependText(text: string, pos) {
		if(this.editor == null) return;
		this.editor.replaceRange(text, pos);
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
			if (this.reader) {
				this.reader.read().then(({ done, value }) => {
					if (done) {
						this.appendText("\n\n==User==\n");
						this.set_ai('stop');
						this.reader = null;
					} else {
						//let text = new TextDecoder().decode(value);
						let text = '';
						try {
							const decodedValue = new TextDecoder().decode(value);
							const chunks = decodedValue.split('\n\n').filter(chunk => chunk.startsWith('data: '));
						
							for (const chunk of chunks) {
								const data = JSON.parse(chunk.substring(5)); // Удаляем 'data: ' из начала строки
								if (data.choices && data.choices[0] && data.choices[0].delta && data.choices[0].delta.content) {
									text += data.choices[0].delta.content;
								}
							}
						} catch (error) {
							console.error('Error parsing response:', error);
							console.error('Received data: "'+ new TextDecoder().decode(value) + '"');
						}
						if(text != ''){
							this.appendText(text);
							this.info_tokens++;
							this.updateStatusBar();
						}
						this.flooding = false;
					}
				}).catch(error => {
					this.set_ai('r-error');
					new Notice(`AI conversation receive error: ${error}`);
					this.reader = null;
				});
			}
		}
	}

	async sendRequest() {
		const context = this.prepareContext();
		const response = await fetch(`${this.settings.ai_url}/chat/completions`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'Authorization': `Bearer ${this.settings.ai_key}`
			},
			body: JSON.stringify(context)
		});

		if (!response.ok) {
			this.set_ai('s-error');
			new Notice(`AICom query error ${response.status}: ${response.statusText}`);
			return;
		}

		this.reader = response.body.getReader();
		this.set_ai('read');
		this.appendText("\n\n==AICom==\n");
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
				.setPlaceholder('https://api.openai.com/v1')
				.setValue(this.plugin.settings.ai_url)
				.onChange(async (value) => {
					this.plugin.settings.ai_url = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
		.setName('AI API key')
		.setDesc('')
		.addText(text => text
			.setValue(this.plugin.settings.ai_key)
			.onChange(async (value) => {
				this.plugin.settings.ai_key = value;
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
