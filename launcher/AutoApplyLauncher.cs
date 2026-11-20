using System;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Reflection;
using System.Threading;
using System.Windows.Forms;
using System.Drawing;

namespace AutoApplyAI
{
    public class Program : Form
    {
        private static NotifyIcon trayIcon;
        private static ContextMenu trayMenu;
        private static Process serverProcess;
        private static string appDir;
        private static string nodeExe;
        private static Mutex singleInstanceMutex;

        [STAThread]
        public static void Main()
        {
            // Ensure single instance
            bool createdNew;
            singleInstanceMutex = new Mutex(true, "AutoApply_AI_SingleInstance_Mutex", out createdNew);
            if (!createdNew)
            {
                // Already running, just open browser
                OpenBrowser("http://localhost:3000");
                return;
            }

            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);

            appDir = AppDomain.CurrentDomain.BaseDirectory;
            nodeExe = ResolveNodeExecutable();

            if (string.IsNullOrEmpty(nodeExe))
            {
                MessageBox.Show(
                    "Google Chrome and Node.js runtime are required.\\nPlease ensure Node.js is installed on your computer.",
                    "AutoApply AI - Missing Runtime",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Error
                );
                return;
            }

            StartServer();
            SetupTray();

            // Wait for server to start, then launch browser
            new Thread(() =>
            {
                bool ready = false;
                for (int i = 0; i < 30; i++)
                {
                    Thread.Sleep(500);
                    if (IsServerResponding("http://localhost:3000/api/status"))
                    {
                        ready = true;
                        break;
                    }
                }
                OpenBrowser("http://localhost:3000");
            }).Start();

            Application.Run();
        }

        private static string ResolveNodeExecutable()
        {
            // 1. Check local bin/node.exe
            string localBin = Path.Combine(appDir, "bin", "node.exe");
            if (File.Exists(localBin)) return localBin;

            string localRoot = Path.Combine(appDir, "node.exe");
            if (File.Exists(localRoot)) return localRoot;

            // 2. Check system PATH
            string pathEnv = Environment.GetEnvironmentVariable("PATH");
            if (!string.IsNullOrEmpty(pathEnv))
            {
                foreach (string p in pathEnv.Split(';'))
                {
                    try
                    {
                        string candidate = Path.Combine(p.Trim(), "node.exe");
                        if (File.Exists(candidate)) return candidate;
                    }
                    catch { }
                }
            }

            // 3. Check default Program Files
            string defaultPath = @"C:\Program Files\nodejs\node.exe";
            if (File.Exists(defaultPath)) return defaultPath;

            return null;
        }

        private static void StartServer()
        {
            try
            {
                // Check if server is already running on port 3000
                if (IsServerResponding("http://localhost:3000/api/status"))
                {
                    return;
                }

                string serverScript = Path.Combine(appDir, "server.js");
                if (!File.Exists(serverScript))
                {
                    serverScript = Path.Combine(appDir, "app.bundle.js");
                }

                ProcessStartInfo psi = new ProcessStartInfo
                {
                    FileName = nodeExe,
                    Arguments = "\"" + serverScript + "\"",
                    WorkingDirectory = appDir,
                    CreateNoWindow = true,
                    UseShellExecute = false,
                    WindowStyle = ProcessWindowStyle.Hidden
                };

                serverProcess = Process.Start(psi);
            }
            catch (Exception ex)
            {
                MessageBox.Show("Failed to launch background server: " + ex.Message, "Error", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
        }

        private static bool IsServerResponding(string url)
        {
            try
            {
                HttpWebRequest req = (HttpWebRequest)WebRequest.Create(url);
                req.Timeout = 1000;
                using (HttpWebResponse resp = (HttpWebResponse)req.GetResponse())
                {
                    return resp.StatusCode == HttpStatusCode.OK;
                }
            }
            catch
            {
                return false;
            }
        }

        private static void OpenBrowser(string url)
        {
            try
            {
                Process.Start(new ProcessStartInfo
                {
                    FileName = url,
                    UseShellExecute = true
                });
            }
            catch { }
        }

        private static void SetupTray()
        {
            trayMenu = new ContextMenu();
            trayMenu.MenuItems.Add("🚀 Open Dashboard", (s, e) => OpenBrowser("http://localhost:3000"));
            trayMenu.MenuItems.Add("⚡ Setup Wizard", (s, e) => OpenBrowser("http://localhost:3000#setup"));
            trayMenu.MenuItems.Add("-");
            trayMenu.MenuItems.Add("🌐 Open LinkedIn for Login", (s, e) => OpenBrowser("https://www.linkedin.com/login"));
            trayMenu.MenuItems.Add("✌️ Open Wellfound for Login", (s, e) => OpenBrowser("https://wellfound.com/login"));
            trayMenu.MenuItems.Add("-");
            trayMenu.MenuItems.Add("✕ Exit & Stop Automation", (s, e) => Shutdown());

            trayIcon = new NotifyIcon
            {
                Text = "AutoApply AI - Automation Suite",
                Icon = SystemIcons.Application,
                ContextMenu = trayMenu,
                Visible = true
            };

            trayIcon.DoubleClick += (s, e) => OpenBrowser("http://localhost:3000");
        }

        private static void Shutdown()
        {
            try
            {
                if (serverProcess != null && !serverProcess.HasExited)
                {
                    serverProcess.Kill();
                }
            }
            catch { }

            try
            {
                trayIcon.Visible = false;
                trayIcon.Dispose();
            }
            catch { }

            singleInstanceMutex.ReleaseMutex();
            Application.Exit();
            Environment.Exit(0);
        }
    }
}
