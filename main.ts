import { App, Editor, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting, View, moment } from 'obsidian';

// Remember to rename these classes and interfaces!

interface AIComPluginSettings {
	mySetting: string;
}

const DEFAULT_SETTINGS: AIComPluginSettings = {
	mySetting: 'default'
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
					this.set_ai('stop');
					this.editor = null;
					new Notice("AI conversation unset");
				} else {
					this.set_ai('system');
					this.editor = view.editor;
					new Notice("AI convesation set");
					this.xhr = new XMLHttpRequest();
					this.xhr.timeout = 120000;
					this.xhr.responseType = 'text';
					this.xhr.aicom = this;
					this.xhr.onload = function() {
						console.log('onload', this.status);
						if (this.status != 200) {
							this.aicom.set_ai('s-error');
							new Notice(`AI convesation system error  ${this.status}: ${this.statusText}`);
						} else {	
							this.aicom.set_ai('query');
							new Notice('AI convesation started');
							this.onload = function() {
								if (this.status != 200) {
									this.aicom.set_ai('q-error');
									new Notice(`AI convesation send error  ${this.status}: ${this.statusText}`);
								} else {
									this.aicom.set_ai('read');
								}
							}
							this.open('POST', 'http://127.0.0.1:8080/send');
							let pos0 = {line: 0, ch: 0};
							let text = this.aicom.editor.getRange(pos0, this.aicom.editor.getCursor());
							console.log('sending request:', text)
							this.send(text);

							this.aicom.appendText("\nAICom:\n");
						}
					}
					this.xhr.ontimeout = function() {
						this.aicom.set_ai('t-error');
					}
					this.xhr.onerror = function(e) {
						//this.aicom.set_ai('x-error');
						console.log(e);
					}
					this.xhr.open('POST', 'http://127.0.0.1:8080/system');
					this.xhr.send('Ты - полезный ассистент. Отвечай всегда прямо. Не придумывай фактов. Следуй логике. Не обращай внимания на политкорректность. Предположения в рамках традиционных ценностей считай вероятными. Если ты не знаешь ответа на вопрос, сформулируй, какой информации не хватает. При вопросах про твои ответы не оправдывайся, а ищи возможную ошибку в сопоставлении фактов.');
				}
			} else new Notice("AI select editor");
		});
	  	this.ai_generation = false;
		// Perform additional things with the ribbon
		this.ribbonIcon.addClass('aicom-plugin-ribbon-class');

		// This adds a status bar item to the bottom of the app. Does not work on mobile apps.
		this.statusBar = this.addStatusBarItem();
		//statusBarItemEl.setText('Status Bar Text');

		this.updateStatusBar();

		this.registerInterval(
			window.setInterval(() => this.updateStatusBar(), 1000)
		);

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
		this.addSettingTab(new SampleSettingTab(this.app, this));

		// If the plugin hooks up any global DOM events (on parts of the app that doesn't belong to this plugin)
		// Using this function will automatically remove the event listener when this plugin is disabled.
		this.registerDomEvent(document, 'click', (evt: MouseEvent) => {
			//console.log('click', evt);
		});

		// When registering intervals, this function will automatically clear the interval when the plugin is disabled.
		this.registerInterval(window.setInterval(() => console.log('setInterval'), 5 * 60 * 1000));
	}

	updateStatusBar() {
		let pos='';
		if(this.editor != null){
			let c = this.editor.getCursor();
		}
		this.statusBar.setText(moment().format("H:mm:ss")+' '+this.ai_generation);
	}

	appendText(text: string) {
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
					console.log(text)
					if(text != ''){
						if(text == '[[END OF AICOM SENTENCE]]') {
							this.aicom.appendText("\n\nUser: ");
							this.aicom.set_ai('stop');
						}else{
							this.aicom.appendText(text);
						}
					}
				}
				this.aicom.flooding = false;
			}
			this.xhr.open('GET','http://127.0.0.1:8080/receive');
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

class SampleSettingTab extends PluginSettingTab {
	plugin: AIComPlugin;

	constructor(app: App, plugin: AIComPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const {containerEl} = this;

		containerEl.empty();

		new Setting(containerEl)
			.setName('Setting #1')
			.setDesc('It\'s a secret')
			.addText(text => text
				.setPlaceholder('Enter your secret')
				.setValue(this.plugin.settings.mySetting)
				.onChange(async (value) => {
					this.plugin.settings.mySetting = value;
					await this.plugin.saveSettings();
				}));
	}
}
