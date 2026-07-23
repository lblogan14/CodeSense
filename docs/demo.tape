# CodeSense terminal demo — render with Charm VHS:  vhs docs/demo.tape
# produces docs/assets/terminal.gif  (install: https://github.com/charmbracelet/vhs)

Output docs/assets/terminal.gif

Set Shell "pwsh"
Set FontSize 18
Set Width 1100
Set Height 640
Set Padding 24
Set Theme "Catppuccin Mocha"

Type "codesense doctor"
Sleep 500ms
Enter
Sleep 4s

Type "codesense start --mock"
Sleep 500ms
Enter
Sleep 3s

# the banner + dashboard URL render here; end on a clean frame
Sleep 2s
