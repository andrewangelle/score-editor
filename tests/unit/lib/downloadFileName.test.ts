/**
 * The name a saved copy leaves with.
 *
 * Once the download has happened the name is on disk and this app cannot reach
 * it, so everything typed has to be made safe on the way out rather than fixed
 * afterwards — and made safe quietly, since a rejected filename would send the
 * user back to a box to guess which character the operating system disliked.
 */

import { downloadFileName, editedFileName } from '#/lib/pdf/document';

const FALLBACK = 'score-edited.pdf';

describe('downloadFileName', () => {
  it('keeps what was typed, and adds the extension it is missing', () => {
    expect(downloadFileName('Prelude', FALLBACK)).toBe('Prelude.pdf');
  });

  it('does not double the extension when one was typed', () => {
    expect(downloadFileName('Prelude.pdf', FALLBACK)).toBe('Prelude.pdf');
    expect(downloadFileName('Prelude.PDF', FALLBACK)).toBe('Prelude.pdf');
  });

  it('leaves an inner dot alone — only the extension is special', () => {
    expect(downloadFileName('BWV 1007 v2.1', FALLBACK)).toBe(
      'BWV 1007 v2.1.pdf',
    );
  });

  it('strips anything that would read as a path', () => {
    expect(downloadFileName('../../etc/passwd', FALLBACK)).toBe('etcpasswd.pdf');
    expect(downloadFileName('C:\\scores\\part', FALLBACK)).toBe(
      'Cscorespart.pdf',
    );
  });

  it('strips the characters Windows reserves, and control characters', () => {
    expect(downloadFileName('cello: "part" <1>|2?*', FALLBACK)).toBe(
      'cello part 12.pdf',
    );
    expect(downloadFileName('part\u0000one\u001f\u007f', FALLBACK)).toBe(
      'partone.pdf',
    );
  });

  it('trims the leading dots and trailing spaces the OS would eat', () => {
    // A leading dot hides the file on Unix; Windows drops trailing dots and
    // spaces silently, so a name ending in one is never the name you get.
    expect(downloadFileName('  .hidden part . ', FALLBACK)).toBe(
      'hidden part.pdf',
    );
  });

  it('falls back rather than saving a file called ".pdf"', () => {
    for (const typed of ['', '   ', '...', '.pdf', '/\\:*?']) {
      expect(downloadFileName(typed, FALLBACK)).toBe(FALLBACK);
    }
  });

  it('accepts the suggestion it is offered unchanged', () => {
    // The box opens holding `editedFileName`, and pressing Enter on it has to
    // save exactly what the button used to save on its own.
    const suggestion = editedFileName('sonata.pdf');
    expect(downloadFileName(suggestion, FALLBACK)).toBe(suggestion);
  });
});
