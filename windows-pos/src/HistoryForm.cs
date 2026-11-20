using System;
using System.Collections.Generic;
using System.Drawing;
using System.Linq;
using System.Windows.Forms;

namespace SarfliPos
{
    /// <summary>
    /// The sales history, in its own small window so the sale panel stays compact.
    /// The main panel owns the data; this window only shows it and asks for cancellations.
    /// </summary>
    internal sealed class HistoryForm : Form
    {
        private readonly ListView _list = new SmoothList();
        private readonly Ui.CardButton _cancel = Ui.Secondary(Strings.CancelRecharge);
        private readonly Label _empty = new Label();
        private readonly Func<string, string> _operatorName;
        private List<Recharge> _items = new List<Recharge>();
        private bool _busy;

        /// <summary>Raised when the cashier asks to cancel a queued recharge (id).</summary>
        public event Action<Recharge> CancelRequested;

        public HistoryForm(Func<string, string> operatorName)
        {
            _operatorName = operatorName;
            Text = Strings.HistoryTitle + " – " + Strings.AppTitle;
            Icon = Ui.AppIcon;
            Font = Ui.F(10f);
            FormBorderStyle = FormBorderStyle.SizableToolWindow;
            StartPosition = FormStartPosition.Manual;
            Size = new Size(580, 440);
            MinimumSize = new Size(440, 260);
            ShowInTaskbar = false;
            TopMost = true;
            BackColor = Ui.Surface;
            KeyPreview = true;
            KeyDown += (s, e) => { if (e.KeyCode == Keys.Escape) Hide(); };

            _list.Dock = DockStyle.Fill;
            _list.View = View.Details;
            _list.FullRowSelect = true;
            _list.MultiSelect = false;
            _list.HideSelection = false;
            _list.HeaderStyle = ColumnHeaderStyle.Nonclickable;
            _list.BorderStyle = BorderStyle.None;
            // Taller rows for fingers: a ListView takes its row height from the small image list.
            _list.SmallImageList = new ImageList { ImageSize = new Size(1, 40) };
            _list.Font = Ui.F(11f);
            _list.Columns.Add(Strings.ColTime, 80);
            _list.Columns.Add(Strings.ColPhone, 100);
            _list.Columns.Add(Strings.ColOperator, 90);
            _list.Columns.Add(Strings.ColAmount, 150);
            _list.Columns.Add(Strings.ColStatus, 100);
            _list.SelectedIndexChanged += (s, e) => UpdateCancel();
            // Drawn by hand: clean white rows, a hairline between them, the status as a coloured badge.
            _list.OwnerDraw = true;
            _list.DrawColumnHeader += DrawHeader;
            _list.DrawItem += (s, e) => { };
            _list.DrawSubItem += DrawCell;

            var bottom = new Panel { Dock = DockStyle.Bottom, Height = 66, Padding = new Padding(12, 10, 12, 10), BackColor = Ui.Background };
            _cancel.Dock = DockStyle.Left;
            _cancel.Width = 220;
            _cancel.ForeColor = Ui.Danger;
            _cancel.Enabled = false;
            _cancel.Click += (s, e) =>
            {
                Recharge r = Selected();
                if (r != null && r.Status == "queued" && CancelRequested != null) CancelRequested(r);
            };
            _empty.Dock = DockStyle.Fill;
            _empty.TextAlign = ContentAlignment.MiddleRight;
            _empty.ForeColor = Ui.Muted;
            var close = Ui.Primary(Strings.Close);
            close.Dock = DockStyle.Right;
            close.Width = 140;
            close.Font = Ui.Semi(11.5f);
            close.Click += (s, e) => Hide();
            bottom.Controls.Add(_empty);
            bottom.Controls.Add(close);
            bottom.Controls.Add(_cancel);

            Controls.Add(_list);
            Controls.Add(new Panel { Dock = DockStyle.Bottom, Height = 1, BackColor = Ui.Line });
            Controls.Add(bottom);

            // Closing only hides it: the panel keeps the data fresh.
            FormClosing += (s, e) =>
            {
                if (e.CloseReason == CloseReason.UserClosing) { e.Cancel = true; Hide(); }
            };
        }

        public bool Busy
        {
            set { _busy = value; UpdateCancel(); }
        }

        public void ShowNear(Form owner)
        {
            if (!Visible)
            {
                Rectangle area = Screen.FromControl(owner).WorkingArea;
                int x = Math.Max(area.Left, owner.Left - Width - 8);
                int y = Math.Min(Math.Max(area.Top, owner.Bottom - Height), area.Bottom - Height);
                Location = new Point(x, y);
                Show(owner);
            }
            Activate();
        }

        public void SetItems(List<Recharge> items)
        {
            _items = items;
            string selected = _list.SelectedItems.Count > 0 ? _list.SelectedItems[0].Name : null;
            _list.BeginUpdate();
            _list.Items.Clear();
            foreach (Recharge r in items)
            {
                var row = new ListViewItem(Format.LocalTime(r.CreatedAt)) { Name = r.Id };
                row.SubItems.Add(Format.Msisdn(r.Msisdn));
                row.SubItems.Add(_operatorName(r.OperatorCode));
                row.SubItems.Add(Describe(r));
                row.SubItems.Add(Strings.Status(r.Status));
                _list.Items.Add(row);
                if (r.Id == selected) row.Selected = true;
            }
            _list.EndUpdate();
            _empty.Text = items.Count == 0 ? Strings.HistoryEmpty : "";
            UpdateCancel();
        }

        public static string Describe(Recharge r)
        {
            return string.IsNullOrEmpty(r.PackageName)
                ? Format.Money(r.AmountMillimes)
                : r.PackageName + " (" + Format.Money(r.AmountMillimes) + ")";
        }

        private void DrawHeader(object sender, DrawListViewColumnHeaderEventArgs e)
        {
            Graphics g = e.Graphics;
            using (var br = new SolidBrush(Ui.Background)) g.FillRectangle(br, e.Bounds);
            using (var pen = new Pen(Ui.Line)) g.DrawLine(pen, e.Bounds.Left, e.Bounds.Bottom - 1, e.Bounds.Right, e.Bounds.Bottom - 1);
            var r = new Rectangle(e.Bounds.X + 12, e.Bounds.Y, e.Bounds.Width - 16, e.Bounds.Height);
            Ui.DrawText(g, e.Header.Text.ToUpperInvariant(), Ui.Semi(8.5f), r, Ui.Muted, Ui.OneLine);
        }

        private void DrawCell(object sender, DrawListViewSubItemEventArgs e)
        {
            Graphics g = e.Graphics;
            bool selected = e.Item.Selected;
            using (var br = new SolidBrush(selected ? Ui.AccentSoft : Ui.Surface)) g.FillRectangle(br, e.Bounds);
            using (var pen = new Pen(Ui.Line)) g.DrawLine(pen, e.Bounds.Left, e.Bounds.Bottom - 1, e.Bounds.Right, e.Bounds.Bottom - 1);
            var r = new Rectangle(e.Bounds.X + 12, e.Bounds.Y, e.Bounds.Width - 16, e.Bounds.Height);
            switch (e.ColumnIndex)
            {
                case 0: Ui.DrawText(g, e.SubItem.Text, Ui.F(10.5f), r, Ui.Muted, Ui.OneLine); break;
                case 1: Ui.DrawText(g, e.SubItem.Text, Ui.Semi(11f), r, Ui.Text, Ui.OneLine); break;
                case 4:
                    Recharge item = _items.FirstOrDefault(i => i.Id == e.Item.Name);
                    string status = item != null ? item.Status : "";
                    Ui.Pill(g, e.SubItem.Text, Ui.Semi(9f), r.X - 2, r.Y + r.Height / 2,
                        status == "cancelled" || status == "canceled" ? Ui.Background : Format.StatusBack(status), StatusFore(status), true);
                    break;
                default: Ui.DrawText(g, e.SubItem.Text, Ui.F(10.5f), r, Ui.Text, Ui.OneLine); break;
            }
        }

        /// <summary>Badge text colour, a dark shade of the badge background.</summary>
        private static Color StatusFore(string status)
        {
            switch (status)
            {
                case "queued": return Color.FromArgb(133, 92, 0);
                case "sending": return Color.FromArgb(25, 85, 170);
                case "succeeded": return Ui.Accent;
                case "failed": return Ui.Danger;
                case "review": return Ui.Warning;
                default: return Ui.Muted;
            }
        }

        /// <summary>A ListView without the flicker of owner-drawn rows on mouse-over.</summary>
        private sealed class SmoothList : ListView
        {
            public SmoothList() { DoubleBuffered = true; }
        }

        private Recharge Selected()
        {
            if (_list.SelectedItems.Count == 0) return null;
            string id = _list.SelectedItems[0].Name;
            return _items.FirstOrDefault(i => i.Id == id);
        }

        private void UpdateCancel()
        {
            Recharge r = Selected();
            _cancel.Enabled = !_busy && r != null && r.Status == "queued";
        }
    }
}
