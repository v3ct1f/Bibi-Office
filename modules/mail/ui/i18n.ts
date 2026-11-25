/**
 * Mail's own texts. The web app's language list (apps/web/src/i18n) isn't reachable from a feature package, so Mail keeps
 * its main labels here and follows the page language (<html lang>, set by the app). Anything not translated shows English.
 */
const en = {
  compose: "Compose", inbox: "Inbox", starred: "Starred", sent: "Sent", drafts: "Drafts", spam: "Spam", trash: "Trash", archive: "Archive",
  labels: "Labels", newLabel: "New label", labelName: "Label name", create: "Create", cancel: "Cancel", deleteLabel: "Delete label",
  search: "Search mail", searchHint: "Search by sender, subject or words. Try from:anna has:attachment after:2026-01-01",
  advanced: "Search options", from: "From", to: "To", cc: "Cc", bcc: "Bcc", subject: "Subject", hasAttachment: "Has attachment", unreadOnly: "Unread only",
  after: "After", before: "Before", searchIn: "Search in", anywhere: "All mail", clear: "Clear",
  reply: "Reply", replyAll: "Reply all", forward: "Forward", send: "Send", discard: "Discard draft", saving: "Saving…", saved: "Draft saved",
  newMessage: "New message", attach: "Attach files", remove: "Remove",
  markRead: "Mark as read", markUnread: "Mark as unread", moveTo: "Move to", moveToInbox: "Move to Inbox", reportSpam: "Report spam", notSpam: "Not spam",
  delete: "Delete", deleteForever: "Delete forever", emptyTrash: "Empty trash now", restore: "Move to Inbox", star: "Star", unstar: "Remove star",
  selectAll: "Select all", selected: "{count} selected", refresh: "Refresh", back: "Back to list", label: "Label", signature: "Signature",
  signatureHint: "Added to the end of new messages and replies.", save: "Save", settings: "Mail settings",
  noMail: "No conversations here.", noResults: "No messages match your search.", selectOne: "Select a conversation to read it.",
  unreadCount: "{count} unread", messagesCount: "{count} messages", draft: "Draft", me: "me", noSubject: "(no subject)",
  showImages: "Show pictures", imagesBlocked: "Pictures from the internet are hidden so the sender can't tell you opened this.",
  inContacts: "In your contacts", addContact: "Add as contact", addLead: "Add as lead", contactAdded: "{name} was added to your contacts.",
  leadRequested: "Asked Leads to add {name}.", sentOk: "Message sent.", undoNothing: "Done.", download: "Download", risky: "This file type can be dangerous. Only open it if you trust the sender.",
  notReady: "Mail isn't set up on this server yet.", noMailbox: "You don't have a mailbox yet. Ask the owner to give you a work email.",
  paused: "Your mailbox is switched off, so you can read old mail but not send or receive. Ask the owner to switch it back on.",
  shortcuts: "Keyboard shortcuts", close: "Close", quoted: "Show earlier text", tooBig: "{name} is too big (the limit is 5 MB per file).",
  sendFail: "Couldn't send", addRecipient: "Add at least one person in To.", onlyMe: "Only you can read this mailbox.",
  linkMailbox: "Link my work mailbox", linkAsked: "Asked for your work mailbox. If you have one, it appears here in a moment.",
  noMailboxLink: "Already have a work email? Link it here.", storageUsed: "{used} of {quota} used",
  full: "Your mailbox is full. Delete old mail or empty the Trash to receive and send again.",
  syncProblem: "New mail couldn't be fetched: {reason}", checkedEveryMinute: "New mail is checked every minute.",
  trashNote: "Mail in Trash and Spam is deleted for good after {days} days.",
};
export type MailKey = keyof typeof en;

const de: Partial<typeof en> = {
  compose: "Verfassen", inbox: "Posteingang", starred: "Markiert", sent: "Gesendet", drafts: "Entwürfe", spam: "Spam", trash: "Papierkorb", archive: "Archiv",
  labels: "Labels", search: "E-Mails durchsuchen", from: "Von", to: "An", subject: "Betreff", reply: "Antworten", replyAll: "Allen antworten", forward: "Weiterleiten",
  send: "Senden", discard: "Entwurf verwerfen", newMessage: "Neue Nachricht", markRead: "Als gelesen markieren", markUnread: "Als ungelesen markieren",
  delete: "Löschen", star: "Markieren", noMail: "Hier gibt es keine Unterhaltungen.", signature: "Signatur", save: "Speichern", cancel: "Abbrechen",
  attach: "Dateien anhängen", moveTo: "Verschieben nach", selectOne: "Wähle eine Unterhaltung zum Lesen aus.", addContact: "Als Kontakt hinzufügen", addLead: "Als Lead hinzufügen",
  showImages: "Bilder anzeigen", refresh: "Aktualisieren", settings: "Mail-Einstellungen", saving: "Speichert…", saved: "Entwurf gespeichert", sentOk: "Nachricht gesendet.",
};
const es: Partial<typeof en> = {
  compose: "Redactar", inbox: "Recibidos", starred: "Destacados", sent: "Enviados", drafts: "Borradores", spam: "Spam", trash: "Papelera", archive: "Archivados",
  labels: "Etiquetas", search: "Buscar en el correo", from: "De", to: "Para", subject: "Asunto", reply: "Responder", replyAll: "Responder a todos", forward: "Reenviar",
  send: "Enviar", discard: "Descartar borrador", newMessage: "Mensaje nuevo", markRead: "Marcar como leído", markUnread: "Marcar como no leído",
  delete: "Eliminar", star: "Destacar", noMail: "No hay conversaciones aquí.", signature: "Firma", save: "Guardar", cancel: "Cancelar",
  attach: "Adjuntar archivos", moveTo: "Mover a", selectOne: "Elige una conversación para leerla.", addContact: "Añadir como contacto", addLead: "Añadir como lead",
  showImages: "Mostrar imágenes", refresh: "Actualizar", settings: "Ajustes del correo", saving: "Guardando…", saved: "Borrador guardado", sentOk: "Mensaje enviado.",
};
const fr: Partial<typeof en> = {
  compose: "Nouveau message", inbox: "Boîte de réception", starred: "Suivis", sent: "Envoyés", drafts: "Brouillons", spam: "Spam", trash: "Corbeille", archive: "Archives",
  labels: "Libellés", search: "Rechercher dans les e-mails", from: "De", to: "À", subject: "Objet", reply: "Répondre", replyAll: "Répondre à tous", forward: "Transférer",
  send: "Envoyer", discard: "Supprimer le brouillon", newMessage: "Nouveau message", markRead: "Marquer comme lu", markUnread: "Marquer comme non lu",
  delete: "Supprimer", star: "Suivre", noMail: "Aucune conversation ici.", signature: "Signature", save: "Enregistrer", cancel: "Annuler",
  attach: "Joindre des fichiers", moveTo: "Déplacer vers", selectOne: "Choisissez une conversation à lire.", addContact: "Ajouter aux contacts", addLead: "Ajouter comme prospect",
  showImages: "Afficher les images", refresh: "Actualiser", settings: "Paramètres de messagerie", saving: "Enregistrement…", saved: "Brouillon enregistré", sentOk: "Message envoyé.",
};
const it: Partial<typeof en> = {
  compose: "Scrivi", inbox: "Posta in arrivo", starred: "Speciali", sent: "Inviata", drafts: "Bozze", spam: "Spam", trash: "Cestino", archive: "Archivio",
  labels: "Etichette", search: "Cerca nella posta", from: "Da", to: "A", subject: "Oggetto", reply: "Rispondi", replyAll: "Rispondi a tutti", forward: "Inoltra",
  send: "Invia", discard: "Elimina bozza", newMessage: "Nuovo messaggio", markRead: "Segna come letto", markUnread: "Segna come da leggere",
  delete: "Elimina", star: "Aggiungi stella", noMail: "Nessuna conversazione qui.", signature: "Firma", save: "Salva", cancel: "Annulla",
  attach: "Allega file", moveTo: "Sposta in", selectOne: "Scegli una conversazione da leggere.", addContact: "Aggiungi ai contatti", addLead: "Aggiungi come lead",
  showImages: "Mostra immagini", refresh: "Aggiorna", settings: "Impostazioni posta", saving: "Salvataggio…", saved: "Bozza salvata", sentOk: "Messaggio inviato.",
};
const nl: Partial<typeof en> = {
  compose: "Opstellen", inbox: "Postvak IN", starred: "Met ster", sent: "Verzonden", drafts: "Concepten", spam: "Spam", trash: "Prullenbak", archive: "Archief",
  labels: "Labels", search: "Zoeken in e-mail", from: "Van", to: "Aan", subject: "Onderwerp", reply: "Beantwoorden", replyAll: "Allen beantwoorden", forward: "Doorsturen",
  send: "Verzenden", discard: "Concept weggooien", newMessage: "Nieuw bericht", markRead: "Markeren als gelezen", markUnread: "Markeren als ongelezen",
  delete: "Verwijderen", star: "Ster toevoegen", noMail: "Geen gesprekken hier.", signature: "Handtekening", save: "Opslaan", cancel: "Annuleren",
  attach: "Bestanden bijvoegen", moveTo: "Verplaatsen naar", selectOne: "Kies een gesprek om te lezen.", addContact: "Toevoegen als contact", addLead: "Toevoegen als lead",
  showImages: "Afbeeldingen tonen", refresh: "Vernieuwen", settings: "E-mailinstellingen", saving: "Opslaan…", saved: "Concept opgeslagen", sentOk: "Bericht verzonden.",
};
const pt: Partial<typeof en> = {
  compose: "Escrever", inbox: "Caixa de entrada", starred: "Com estrela", sent: "Enviados", drafts: "Rascunhos", spam: "Spam", trash: "Lixo", archive: "Arquivados",
  labels: "Etiquetas", search: "Pesquisar no correio", from: "De", to: "Para", subject: "Assunto", reply: "Responder", replyAll: "Responder a todos", forward: "Encaminhar",
  send: "Enviar", discard: "Descartar rascunho", newMessage: "Nova mensagem", markRead: "Marcar como lida", markUnread: "Marcar como não lida",
  delete: "Eliminar", star: "Marcar com estrela", noMail: "Não há conversas aqui.", signature: "Assinatura", save: "Guardar", cancel: "Cancelar",
  attach: "Anexar ficheiros", moveTo: "Mover para", selectOne: "Escolha uma conversa para ler.", addContact: "Adicionar como contacto", addLead: "Adicionar como lead",
  showImages: "Mostrar imagens", refresh: "Atualizar", settings: "Definições do correio", saving: "A guardar…", saved: "Rascunho guardado", sentOk: "Mensagem enviada.",
};
const DICTS: Record<string, Partial<typeof en>> = { de, es, fr, it, nl, pt };

const lang = () => (typeof document === "undefined" ? "en" : (document.documentElement.lang || "en").toLowerCase().split("-")[0]!);

/** Mail's text in the page language, with `{name}` style placeholders filled in. */
export function tt(key: MailKey, vars?: Record<string, string | number>): string {
  const s = DICTS[lang()]?.[key] ?? en[key];
  return vars ? s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : s;
}
export const MAIL_LANGUAGES = ["en", ...Object.keys(DICTS)];
export const MAIL_TEXT_KEYS = Object.keys(en) as MailKey[];
export const mailText = { en, ...DICTS };
