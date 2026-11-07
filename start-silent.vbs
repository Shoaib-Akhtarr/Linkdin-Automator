Set WshShell = CreateObject("WScript.Shell")
WshShell.Run "cmd /c cd /d ""C:\Users\mshoa\OneDrive\Desktop\Linkdin automation"" && ""C:\Program Files\nodejs\node.exe"" server.js > ""%LOCALAPPDATA%\LinkdinAutomation\server.log"" 2>&1", 0, False
