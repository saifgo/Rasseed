namespace SarfliPos
{
    /// <summary>
    /// Every text shown to the cashier. French is the default. To add a language, write a
    /// UseArabic()/UseEnglish() method that assigns every field, and call it from Program.Main
    /// (Arabic will also need RightToLeft on the forms).
    /// </summary>
    public static class Strings
    {
        public static string AppTitle;
        public static string UnexpectedError;

        // Pairing
        public static string PairTitle;
        public static string PairIntro;
        public static string PairCode;
        public static string PairTerminalName;
        public static string PairServer;
        public static string PairAdvanced;
        public static string PairButton;
        public static string PairWorking;
        public static string PairCodeInvalidFormat;
        public static string PairServerInvalid;

        // Main
        public static string MenuTerminal;
        public static string MenuRefresh;
        public static string MenuUnpair;
        public static string MenuQuit;
        public static string Refresh;
        public static string Balances;
        public static string SarfliSource;
        public static string UpdatedAt;
        public static string Loading;
        public static string Connected;
        public static string ConnectionLost;
        public static string TerminalLabel;

        public static string Offline;
        public static string OfflineShort;
        public static string Close;
        public static string QuitConfirm;
        public static string OtherAmountShort;
        public static string Next;
        public static string EnterNumberShort;
        public static string NewSaleShort;
        public static string LiveExplainShort;
        public static string SectionPackages;
        public static string SectionCredit;
        public static string StepOperator;
        public static string StepOperatorHint;
        public static string StepResult;
        public static string Available;
        public static string NothingToSell;
        public static string NotEnough;
        public static string DailyLimitReached;
        public static string OverDailyLimit;
        public static string MaxPerRecharge;
        public static string OtherAmount;
        public static string SendTo;
        public static string EnterNumber;
        public static string NoAnswer;
        public static string Refused;
        public static string FailedRefunded;
        public static string FailedNotCompatible;
        public static string ReviewExplain;
        public static string LiveExplain;
        public static string NewSale;
        public static string MenuOnTop;
        public static string SaleTitle;
        public static string SaleOperator;
        public static string ModeRecharge;
        public static string ModeLight;
        public static string ModeInternet;
        public static string LightHint;
        public static string InternetHint;
        public static string KindUnavailable;
        public static string ModePackage;
        public static string Phone;
        public static string PhoneHint;
        public static string Amount;
        public static string AmountHint;
        public static string PackageList;
        public static string Send;
        public static string Sending;
        public static string RechargeDisabled;
        public static string NoPackages;
        public static string ChooseOperator;
        public static string InvalidPhone;
        public static string InvalidAmount;
        public static string ChoosePackage;

        public static string ConfirmTitle;
        public static string ConfirmQuestion;
        public static string ConfirmNumber;
        public static string ConfirmAmount;
        public static string ConfirmPackage;
        public static string ConfirmOperator;
        public static string ConfirmYes;
        public static string ConfirmNo;

        public static string PendingNotConfirmed;
        public static string PendingSafeRetry;
        public static string Retry;
        public static string Abandon;
        public static string AbandonConfirm;
        public static string QuitWithPending;

        public static string SentToQueue;
        public static string NoticeSucceeded;
        public static string NoticeFailed;
        public static string NoticeReview;
        public static string NoticeCancelled;
        public static string NoticeOk;

        public static string HistoryTitle;
        public static string ColTime;
        public static string ColPhone;
        public static string ColOperator;
        public static string ColAmount;
        public static string ColStatus;
        public static string CancelRecharge;
        public static string CancelConfirm;
        public static string HistoryEmpty;

        public static string UnpairConfirm;
        public static string Revoked;

        // Statuses
        public static string StatusQueued;
        public static string StatusSending;
        public static string StatusSucceeded;
        public static string StatusFailed;
        public static string StatusReview;
        public static string StatusCancelled;

        static Strings()
        {
            UseFrench();
        }

        public static void UseFrench()
        {
            AppTitle = "Sarfli POS";
            UnexpectedError = "Une erreur inattendue s'est produite.";

            PairTitle = "Sarfli POS – Association du terminal";
            PairIntro = "Sur sarfli.com, ouvrez Acheter → « Utiliser Sarfli sur un PC du magasin », obtenez un code à 6 chiffres (valable 10 minutes) et saisissez-le ici.";
            PairCode = "Code à 6 chiffres";
            PairTerminalName = "Nom de ce poste";
            PairServer = "Adresse du serveur";
            PairAdvanced = "Avancé";
            PairButton = "Associer";
            PairWorking = "Association en cours…";
            PairCodeInvalidFormat = "Le code doit contenir exactement 6 chiffres.";
            PairServerInvalid = "Adresse du serveur invalide.";

            MenuTerminal = "&Terminal";
            MenuRefresh = "&Actualiser";
            MenuUnpair = "&Dissocier ce terminal…";
            MenuQuit = "&Quitter";
            Refresh = "Actualiser (F5)";
            Balances = "Soldes";
            SarfliSource = "Crédit Sarfli (admin)";
            UpdatedAt = "Mis à jour à {0}";
            Loading = "Chargement…";
            Connected = "Connecté";
            ConnectionLost = "Connexion perdue : {0}";
            TerminalLabel = "Terminal : {0}";

            Offline = "Hors connexion – nouvel essai automatique";
            OfflineShort = "Hors connexion";
            Close = "Fermer";
            QuitConfirm = "Fermer Sarfli POS ?";
            OtherAmountShort = "Autre";
            Next = "Suivant";
            EnterNumberShort = "Numéro du client";
            NewSaleShort = "Nouvelle vente";
            LiveExplainShort = "Le résultat s'affichera en bas.";
            SectionPackages = "Forfaits internet";
            SectionCredit = "Crédit";
            StepOperator = "Nouvelle vente";
            StepOperatorHint = "Choisissez l'opérateur";
            StepResult = "Résultat de la vente";
            Available = "Disponible";
            NothingToSell = "Rien à vendre pour l'instant";
            NotEnough = "Crédit insuffisant";
            DailyLimitReached = "Limite du jour atteinte";
            OverDailyLimit = "Dépasse la limite du jour";
            MaxPerRecharge = "Maximum {0} par recharge";
            OtherAmount = "Autre montant…";
            SendTo = "Envoyer au {0}";
            EnterNumber = "Saisissez le numéro (8 chiffres)";
            NoAnswer = "Pas de réponse";
            Refused = "Refusée";
            FailedRefunded = "Rien n'a été envoyé. Le montant a été rendu.";
            FailedNotCompatible = "Ce numéro ne peut pas recevoir ce forfait. Rien n'a été envoyé, le montant a été rendu.";
            ReviewExplain = "Résultat incertain : un administrateur va vérifier.";
            LiveExplain = "Vous pouvez commencer la vente suivante : le résultat s'affichera en bas.";
            NewSale = "Nouvelle vente  (Entrée)";
            MenuOnTop = "Toujours au premier plan";
            SaleTitle = "Nouvelle vente";
            SaleOperator = "Opérateur";
            ModeRecharge = "Recharge";
            ModeLight = "Light";
            ModeInternet = "Internet";
            LightHint = "Recharge : montant au choix";
            InternetHint = "Forfaits : {0}";
            KindUnavailable = "Indisponible pour cet opérateur";
            ModePackage = "Forfait";
            Phone = "Numéro du client";
            PhoneHint = "8 chiffres (+216 ou 00216 acceptés)";
            Amount = "Montant (DT)";
            AmountHint = "ex. 5 ou 2,500";
            PackageList = "Forfaits disponibles";
            Send = "Envoyer";
            Sending = "Envoi en cours…";
            RechargeDisabled = "Recharge simple indisponible pour cet opérateur.";
            NoPackages = "Aucun forfait pour cet opérateur.";
            ChooseOperator = "Choisissez un opérateur.";
            InvalidPhone = "Numéro invalide : saisissez 8 chiffres (ex. 22 123 456).";
            InvalidAmount = "Montant invalide : saisissez un montant en DT supérieur à 0 (3 décimales au plus).";
            ChoosePackage = "Choisissez un forfait dans la liste.";

            ConfirmTitle = "Confirmer la vente";
            ConfirmQuestion = "Vérifiez avec le client avant d'envoyer :";
            ConfirmNumber = "Numéro";
            ConfirmAmount = "Montant";
            ConfirmPackage = "Forfait";
            ConfirmOperator = "Opérateur";
            ConfirmYes = "Confirmer l'envoi";
            ConfirmNo = "Annuler";

            PendingNotConfirmed = "Vente non confirmée : {0}";
            PendingSafeRetry = "Réessayer renvoie la même vente : elle ne sera jamais facturée deux fois.";
            Retry = "Réessayer";
            Abandon = "Abandonner";
            AbandonConfirm = "Abandonner cette vente ?\n\nSi le serveur l'a déjà reçue, elle apparaîtra quand même dans l'historique. Vérifiez l'historique avant de refaire la vente.";
            QuitWithPending = "Une vente n'est pas encore confirmée. Quitter quand même ?";

            SentToQueue = "Vente enregistrée ({0}) : {1} – {2}. Envoi en cours…";
            NoticeSucceeded = "RÉUSSIE : {0} envoyé au {1} ({2}).";
            NoticeFailed = "ÉCHEC : {0} pour le {1} n'a pas été envoyé ({2}). Le montant a été rendu au solde.";
            NoticeReview = "À VÉRIFIER : {0} pour le {1} ({2}). Résultat incertain, un administrateur va trancher.";
            NoticeCancelled = "Annulée : {0} pour le {1}. Le montant a été rendu au solde.";
            NoticeOk = "OK";

            HistoryTitle = "Historique";
            ColTime = "Heure";
            ColPhone = "Numéro";
            ColOperator = "Opérateur";
            ColAmount = "Montant";
            ColStatus = "Statut";
            CancelRecharge = "Annuler la recharge";
            CancelConfirm = "Annuler la recharge {0} pour le {1} ({2}) ?\nLe montant sera rendu au solde.";
            HistoryEmpty = "Aucune vente pour le moment.";

            UnpairConfirm = "Dissocier ce poste ?\n\nIl faudra un nouveau code depuis sarfli.com pour l'utiliser à nouveau.";
            Revoked = "Ce terminal n'est plus autorisé (révoqué ou accès retiré). Associez-le à nouveau avec un nouveau code.";

            StatusQueued = "En attente";
            StatusSending = "Envoi en cours";
            StatusSucceeded = "Réussie";
            StatusFailed = "Échouée";
            StatusReview = "À vérifier";
            StatusCancelled = "Annulée";
        }

        public static string Status(string status)
        {
            switch (status)
            {
                case "queued": return StatusQueued;
                case "sending": return StatusSending;
                case "succeeded": return StatusSucceeded;
                case "failed": return StatusFailed;
                case "review": return StatusReview;
                case "cancelled":
                case "canceled": return StatusCancelled;
                default: return status ?? "";
            }
        }

        /// <summary>Friendly text for an API error code (API.md) or a client-side code.</summary>
        public static string Error(string code)
        {
            switch (code)
            {
                // 409 business errors
                case "insufficient_credit": return "Solde insuffisant pour cet opérateur.";
                case "sarfli_credit_insufficient": return "Crédit Sarfli insuffisant pour cet opérateur (ventes non confirmées et crédit des clients exclus).";
                case "pos_daily_limit": return "Ce PC a atteint sa limite de vente du jour (fixée sur sarfli.com).";
                case "pos_recharge_limit": return "Ce montant dépasse le maximum autorisé pour une recharge.";
                case "invalid_msisdn": return "Numéro de téléphone refusé. Vérifiez les 8 chiffres.";
                case "invalid_amount": return "Montant refusé par le serveur.";
                case "operator_unavailable": return "Cet opérateur est indisponible pour le moment.";
                case "recharge_unavailable": return "La recharge simple n'est pas disponible pour cet opérateur.";
                case "package_unavailable": return "Ce forfait n'est plus disponible.";
                case "marketplace_closed": return "Le service est fermé pour le moment. Réessayez plus tard.";
                case "cannot_cancel": return "Cette recharge ne peut plus être annulée : elle est déjà en cours d'envoi ou terminée.";
                case "invalid_code": return "Code invalide ou expiré. Générez un nouveau code sur sarfli.com.";
                // generic HTTP errors
                case "bad_request": return "Demande refusée par le serveur (données invalides).";
                case "unauthorized": return "Ce terminal n'est plus autorisé. Associez-le à nouveau.";
                case "not_found": return "Élément introuvable sur le serveur.";
                case "rate_limited": return "Trop de demandes. Patientez quelques secondes puis réessayez.";
                case "server_error": return "Erreur du serveur. Réessayez dans un instant.";
                // client side
                case "network": return "Impossible de joindre le serveur. Vérifiez la connexion Internet.";
                case "timeout": return "Le serveur ne répond pas (délai de 20 s dépassé).";
                case "bad_response": return "Réponse illisible du serveur (proxy ou connexion instable).";
                case "bad_url": return "Adresse du serveur invalide.";
                default: return "Erreur inattendue (" + (code ?? "?") + ").";
            }
        }
    }
}
