import {App, Notice, Plugin, PluginSettingTab, Setting, TAbstractFile, TFolder} from 'obsidian';

interface MoveRule {
	id: string;           // 规则唯一标识
	name: string;         // 规则名称
	sourcePath: string;   // 源文件夹路径
	filePattern: string;  // 文件名匹配模式（正则表达式）
	targetPath: string;   // 目标文件夹路径
	enabled: boolean;     // 规则是否启用
}

interface FileMoverSettings {
	rules: MoveRule[];
	showMoveNotification: boolean;
}

const DEFAULT_SETTINGS: FileMoverSettings = {
	rules: [],
	showMoveNotification: true
}

export default class FileMoverPlugin extends Plugin {
	settings: FileMoverSettings;
	private isCommandExecuting: boolean = false;

	async onload() {
		await this.loadSettings();

		// 注册文件移动事件监听器
		this.registerEvent(
			this.app.vault.on('modify', (file: TAbstractFile) => {
				if (this.isCommandExecuting && this.settings.showMoveNotification) {
					new Notice(`File moved: ${file.path}`);
				}
			})
		);

		// 为每个规则添加命令
		this.settings.rules.forEach(rule => {
			this.addCommand({
				id: `execute-move-rule-${rule.id}`,
				name: `Execute Move Rule: ${rule.name}`,
				callback: async () => {
					this.isCommandExecuting = true;
					await this.executeMoveRule(rule);
					this.isCommandExecuting = false;
				}
			});
		});

		// 添加设置标签
		this.addSettingTab(new FileMoverSettingTab(this.app, this));
	}

	onunload() {
		console.log('FileMoverPlugin unloaded');
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
		this.onload();
	}

	async executeMoveRule(rule: MoveRule) {
		if (!rule.enabled) {
			new Notice(`Rule "${rule.name}" is disabled.`);
			return;
		}

		const sourceFolder = this.app.vault.getAbstractFileByPath(rule.sourcePath);
		if (!sourceFolder || !(sourceFolder instanceof TFolder)) {
			new Notice(`Source folder "${rule.sourcePath}" not found.`);
			return;
		}

		// 确保目标文件夹存在
		const targetFolder = this.app.vault.getAbstractFileByPath(rule.targetPath);
		if (!targetFolder) {
			try {
				await this.app.vault.createFolder(rule.targetPath);
			} catch (error) {
				new Notice(`Failed to create target folder: ${rule.targetPath}`);
				return;
			}
		}

		// 编译正则表达式
		try {
			const regex = new RegExp(rule.filePattern);
			await this.processFolder(sourceFolder, regex, rule.targetPath);
		} catch (error) {
			new Notice(`Invalid regular expression: ${rule.filePattern}`);
			console.error(error);
		}
	}

	async processFolder(folder: TFolder, pattern: RegExp, targetPath: string) {
		// 用一个数组收集所有需要移动的文件
		const movePromises: Promise<void>[] = [];

		for (const child of folder.children) {
			if (child instanceof TFolder) {
				// 递归处理子文件夹
				await this.processFolder(child, pattern, targetPath);
			} else {
				// 检查文件是否匹配模式
				if (pattern.test(child.name)) {
					const newPath = `${targetPath}/${child.name}`;
					const movePromise = this.moveFile(child, newPath);
					movePromises.push(movePromise);
				}
			}
		}

		// 等待所有文件移动操作完成
		await Promise.all(movePromises);
	}

	// 提取文件移动逻辑到一个独立函数，便于并发调用
	async moveFile(child: TAbstractFile, newPath: string) {
		try {
			await this.app.vault.rename(child, newPath);
			if (this.settings.showMoveNotification) {
				new Notice(`Moved file: ${child.path} -> ${newPath}`);
			}
			console.log(`Moved file: ${child.path} -> ${newPath}`);
		} catch (error) {
			console.error(`Failed to move file: ${child.path}`, error);
			new Notice(`Failed to move file: ${child.path}`);
		}
	}
}

class FileMoverSettingTab extends PluginSettingTab {
	plugin: FileMoverPlugin;

	constructor(app: App, plugin: FileMoverPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const {containerEl} = this;
		containerEl.empty();

		// 通知设置
		new Setting(containerEl)
			.setName('Show Move Notifications')
			.setDesc('Show a notification when a file is moved')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.showMoveNotification)
				.onChange(async (value) => {
					this.plugin.settings.showMoveNotification = value;
					await this.plugin.saveSettings();
				}));

		// 规则列表标题
		containerEl.createEl('h2', {text: 'Move Rules'});

		// 显示现有规则
		this.plugin.settings.rules.forEach((rule, index) => {
			const ruleContainer = containerEl.createEl('div', {
				cls: 'rule-container'
			});

			new Setting(ruleContainer)
				.setName('Rule Name')
				.addText(text => text
					.setValue(rule.name)
					.onChange(async (value) => {
						this.plugin.settings.rules[index].name = value;
						await this.plugin.saveSettings();
					}));

			new Setting(ruleContainer)
				.setName('Source Path')
				.addText(text => text
					.setValue(rule.sourcePath)
					.onChange(async (value) => {
						this.plugin.settings.rules[index].sourcePath = value;
						await this.plugin.saveSettings();
					}));

			new Setting(ruleContainer)
				.setName('File Pattern (Regex)')
				.addText(text => text
					.setValue(rule.filePattern)
					.onChange(async (value) => {
						this.plugin.settings.rules[index].filePattern = value;
						await this.plugin.saveSettings();
					}));

			new Setting(ruleContainer)
				.setName('Target Path')
				.addText(text => text
					.setValue(rule.targetPath)
					.onChange(async (value) => {
						this.plugin.settings.rules[index].targetPath = value;
						await this.plugin.saveSettings();
					}));

			new Setting(ruleContainer)
				.setName('Enabled')
				.addToggle(toggle => toggle
					.setValue(rule.enabled)
					.onChange(async (value) => {
						this.plugin.settings.rules[index].enabled = value;
						await this.plugin.saveSettings();
					}))
				.addButton(button => button
					.setButtonText('Delete Rule')
					.onClick(async () => {
						this.plugin.settings.rules.splice(index, 1);
						await this.plugin.saveSettings();
						this.display();
					}));

			ruleContainer.createEl('hr');
		});

		// 添加新规则按钮
		new Setting(containerEl)
			.setName('Add New Rule')
			.addButton(button => button
				.setButtonText('Add Rule')
				.onClick(async () => {
					const newRule: MoveRule = {
						id: String(Date.now()),
						name: 'New Rule',
						sourcePath: '',
						filePattern: '',
						targetPath: '',
						enabled: true
					};
					this.plugin.settings.rules.push(newRule);
					await this.plugin.saveSettings();
					this.display();
				}));
	}
}
