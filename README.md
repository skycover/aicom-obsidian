# AI Companion Obsidian Plugin

This is an AI Companion plugin made for Obsidian (https://obsidian.md).
It uses locally maintained LLama-2 AI model served via
https://github.com/skycover/aicom-llama.cpp server.

You may start conversation inside any document by clicking on a robot icon
in a toolbar. All text before cursor will be threated as a prior conversation
and the inferenced answer will be typed after your last query.

Special marking rules for conversation document:
```
==Params==
Optional section to place metaparameters if you wish to override settings.
NB. Currently collected, but not evaluated.

==System==
Optional section to place the system prompt here if you wish to override settings.

==User==
Your question here.

==AICom==
AI answer

==User==
...and so on.
```

You may use multiline text between separators.
Don't forget newline before each separator but first.

You are free to edit any text before next query.

You a free to switch to other document tab, while inference in progress.

If you wish to stop inference just click robot icon again.

Look at "AICom: status NNNN PPP" string in a status bar,
where NNNN is a submitted token count and PPP is generated token count
for current inference.

NB. At the border of a context window of your downloaded AI model the inference
may work unexpectedly. So if model behave strange, check the status bar numbers.

AICom needs to connect to the local AI server (it may be also installed on
a different computer and accessed via network).
Follow instructions in https://github.com/skycover/aicom-llama.cpp to setup
your own AI brain.