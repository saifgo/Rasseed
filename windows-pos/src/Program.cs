using System;
using System.Net;
using System.Threading;
using System.Windows.Forms;

namespace SarfliPos
{
    internal static class Program
    {
        [STAThread]
        private static void Main()
        {
            // .NET 4.5 on Windows 7 does not offer TLS 1.2 by default. 3072 = Tls12, 768 = Tls11.
            ServicePointManager.SecurityProtocol =
                SecurityProtocolType.Tls | (SecurityProtocolType)768 | (SecurityProtocolType)3072;
            ServicePointManager.Expect100Continue = false;
            ServicePointManager.DefaultConnectionLimit = 4;

            Strings.UseFrench();

            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.SetUnhandledExceptionMode(UnhandledExceptionMode.CatchException);
            Application.ThreadException += OnThreadException;

            // Pair -> main screen -> (unpaired or revoked) -> pair again ... until the user quits.
            while (true)
            {
                PosConfig config = PosConfig.Load();
                if (config == null || !config.IsPaired)
                {
                    using (var pair = new PairForm(config != null ? config.ApiBase : null))
                    {
                        if (pair.ShowDialog() != DialogResult.OK) return;
                        config = pair.Result;
                    }
                }

                using (var main = new MainForm(config))
                {
                    main.ShowDialog();
                    if (!main.BackToPairing) return;
                }
            }
        }

        private static void OnThreadException(object sender, ThreadExceptionEventArgs e)
        {
            MessageBox.Show(Strings.UnexpectedError + "\n\n" + e.Exception.Message, Strings.AppTitle,
                MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }
}
