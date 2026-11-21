// Opens the iOS share sheet for a visit, as text or as a PDF. The PDF is made
// on the phone, lives in the cache only while the share sheet is open, and is
// deleted as soon as it closes.

import { Directory, File, Paths } from 'expo-file-system';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { Share } from 'react-native';

import { pdfFileName, visitShareHtml, visitShareText, type ShareOptions } from '../share/visit';
import type { Visit } from '../storage/visits';

/** Holds the one PDF being shared; emptied before and after every share. */
const shareDirectory = new Directory(Paths.cache, 'share');

/** 0.75 inch on every side, in points. */
const MARGIN = 54;

function clearSharedFiles(): void {
  try {
    if (shareDirectory.exists) shareDirectory.delete();
  } catch {
    // Nothing to do: the cache is emptied again before the next share.
  }
}

export async function shareVisitAsText(visit: Visit, options: ShareOptions): Promise<void> {
  await Share.share({ title: visit.title, message: visitShareText(visit, options) });
}

export async function shareVisitAsPdf(visit: Visit, options: ShareOptions): Promise<void> {
  if (!(await Sharing.isAvailableAsync())) {
    throw new Error('Sharing files is not available on this device.');
  }
  clearSharedFiles();
  const { uri } = await Print.printToFileAsync({
    html: visitShareHtml(visit, options),
    margins: { top: MARGIN, right: MARGIN, bottom: MARGIN, left: MARGIN },
  });
  const printed = new File(uri);
  try {
    shareDirectory.create({ intermediates: true, idempotent: true });
    // A readable name for whoever receives it, instead of a random id.
    const named = new File(shareDirectory, pdfFileName(visit));
    printed.moveSync(named);
    // Resolves when the share sheet closes.
    await Sharing.shareAsync(named.uri, {
      mimeType: 'application/pdf',
      UTI: 'com.adobe.pdf',
      dialogTitle: visit.title,
    });
  } finally {
    if (printed.exists) printed.delete();
    clearSharedFiles();
  }
}
