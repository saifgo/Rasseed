using System;
using System.Drawing;
using System.Globalization;
using System.Text;

namespace SarfliPos
{
    internal static class Format
    {
        /// <summary>12000 -> "12.000 DT".</summary>
        public static string Money(long millimes)
        {
            return (millimes / 1000m).ToString("0.000", CultureInfo.InvariantCulture) + " DT";
        }

        /// <summary>
        /// Parses a DT amount typed by the cashier ("5", "2,5", "2.500") into millimes.
        /// Returns -1 when invalid (empty, not positive or more than 3 decimals).
        /// </summary>
        public static long ParseAmountMillimes(string text)
        {
            string s = (text ?? "").Trim().Replace(" ", "").Replace(',', '.');
            if (s.EndsWith("DT", StringComparison.OrdinalIgnoreCase)) s = s.Substring(0, s.Length - 2);
            decimal dt;
            if (!decimal.TryParse(s, NumberStyles.AllowDecimalPoint, CultureInfo.InvariantCulture, out dt)) return -1;
            decimal m = dt * 1000m;
            if (m <= 0 || m != decimal.Truncate(m) || m > 10000000m) return -1;
            return (long)m;
        }

        /// <summary>
        /// Normalizes a Tunisian number: accepts 8 digits, +216… or 00216…, with spaces, dots or dashes.
        /// Returns the 8 local digits, or null when invalid.
        /// </summary>
        public static string NormalizeMsisdn(string text)
        {
            var sb = new StringBuilder();
            foreach (char c in text ?? "")
            {
                if (c == ' ' || c == '-' || c == '.' || c == '(' || c == ')' || c == ' ') continue;
                sb.Append(c);
            }
            string s = sb.ToString();
            if (s.StartsWith("+216", StringComparison.Ordinal)) s = s.Substring(4);
            else if (s.StartsWith("00216", StringComparison.Ordinal)) s = s.Substring(5);
            if (s.Length != 8) return null;
            foreach (char c in s) if (c < '0' || c > '9') return null;
            return s;
        }

        /// <summary>"22123456" -> "22 123 456".</summary>
        public static string Msisdn(string msisdn)
        {
            if (msisdn != null && msisdn.Length == 8)
                return msisdn.Substring(0, 2) + " " + msisdn.Substring(2, 3) + " " + msisdn.Substring(5, 3);
            return msisdn ?? "";
        }

        public static string LocalTime(string iso)
        {
            DateTime t;
            if (DateTime.TryParse(iso, CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind, out t))
            {
                t = t.ToLocalTime();
                return t.Date == DateTime.Today ? t.ToString("HH:mm") : t.ToString("dd/MM HH:mm");
            }
            return iso ?? "";
        }

        public static Color ParseColor(string hex, Color fallback)
        {
            try
            {
                if (!string.IsNullOrEmpty(hex)) return ColorTranslator.FromHtml(hex);
            }
            catch (Exception) { }
            return fallback;
        }

        public static Color Lighten(Color c, double amount)
        {
            return Color.FromArgb(
                (int)(c.R + (255 - c.R) * amount),
                (int)(c.G + (255 - c.G) * amount),
                (int)(c.B + (255 - c.B) * amount));
        }

        public static Color StatusBack(string status)
        {
            switch (status)
            {
                case "queued": return Color.FromArgb(255, 246, 213);
                case "sending": return Color.FromArgb(221, 235, 255);
                case "succeeded": return Color.FromArgb(220, 245, 224);
                case "failed": return Color.FromArgb(251, 222, 222);
                case "review": return Color.FromArgb(255, 231, 204);
                default: return SystemColors.Window;
            }
        }
    }
}
