/**
 * WsIncidentModal — automatic incident popup over the existing WebSocket
 * diagnostic recorder.
 *
 * It is UI only:
 * - it reads the recorder's snapshot/ring buffer, it never writes or clears;
 * - it never touches the composer draft, the message list or history;
 * - it never reloads, reconnects or navigates;
 * - it shows metadata only (ids, timestamps, codes, counts), never message
 *   text, draft content, tokens or cookies.
 *
 * The "Copy Diagnostic" button copies exactly what
 * `window.__MILI_WS_DIAG__.copy()` copies, without the user opening DevTools.
 */
import * as React from 'react';
import {
  Badge,
  Box,
  Button,
  Code,
  Dialog,
  Portal,
  Stack,
  Text,
} from '@chakra-ui/react';
import {
  exportWsDiagnostics,
  subscribeWsIncidents,
  type WsIncidentNotice,
} from '@/utils/ws-diagnostics';

type CopyState = 'idle' | 'copied' | 'failed';

function formatWhen(iso: string | null | undefined): string {
  if (!iso) return 'unknown';
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return String(iso);
  }
}

/** Copy text without depending on a particular clipboard polyfill. */
async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to the manual path below
  }
  return false;
}

export function WsIncidentModal() {
  const [notice, setNotice] = React.useState<WsIncidentNotice | null>(null);
  const [open, setOpen] = React.useState(false);
  const [copyState, setCopyState] = React.useState<CopyState>('idle');

  React.useEffect(() => {
    const unsubscribe = subscribeWsIncidents((incoming) => {
      setNotice(incoming);
      setCopyState('idle');
      setOpen(true);
    });
    return unsubscribe;
  }, []);

  const onCopy = React.useCallback(async () => {
    const ok = await copyText(exportWsDiagnostics());
    setCopyState(ok ? 'copied' : 'failed');
  }, []);

  const onClose = React.useCallback(() => {
    // Closing never clears diagnostics, the draft or the incident history.
    setOpen(false);
  }, []);

  const incident = notice?.incident ?? null;
  const eventCount = incident?.eventsBeforeClose?.length ?? notice?.log.length ?? 0;

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(details) => {
        if (!details.open) onClose();
      }}
      size="lg"
      role="alertdialog"
      aria-label="Masalah koneksi terdeteksi"
    >
      <Portal>
        <Dialog.Backdrop />
        <Dialog.Positioner>
          <Dialog.Content>
            <Dialog.Header>
              <Stack gap={1}>
                <Text fontWeight="semibold">Masalah koneksi terdeteksi</Text>
                <Badge colorPalette="red" alignSelf="flex-start" variant="surface">
                  {notice?.kind ?? 'incident'}
                </Badge>
              </Stack>
            </Dialog.Header>
            <Dialog.Body>
              <Stack gap={3}>
                <Text>
                  Koneksi Mili terputus atau pengiriman pesan gagal. Diagnostic
                  sudah direkam.
                </Text>
                <Stack gap={1} fontSize="sm">
                  <Text>
                    <Text as="span" color="fg.muted">
                      Waktu insiden:
                    </Text>{' '}
                    {formatWhen(incident?.incidentAt)}
                  </Text>
                  <Text>
                    <Text as="span" color="fg.muted">
                      Koneksi:
                    </Text>{' '}
                    <Code>{incident?.connectionId ?? 'n/a'}</Code>
                  </Text>
                  <Text>
                    <Text as="span" color="fg.muted">
                      Close code:
                    </Text>{' '}
                    <Code>{incident?.closeCode ?? 'n/a'}</Code>
                  </Text>
                  <Text>
                    <Text as="span" color="fg.muted">
                      Reason:
                    </Text>{' '}
                    <Code>{incident?.closeReason || 'n/a'}</Code>
                  </Text>
                  <Text>
                    <Text as="span" color="fg.muted">
                      Ready state saat close:
                    </Text>{' '}
                    <Code>{incident?.readyStateAtClose ?? 'n/a'}</Code>
                  </Text>
                  <Text>
                    <Text as="span" color="fg.muted">
                      Abnormal:
                    </Text>{' '}
                    <Code>{incident ? String(incident.abnormal) : 'n/a'}</Code>
                    {'  '}
                    <Text as="span" color="fg.muted">
                      Reconnect dijadwalkan:
                    </Text>{' '}
                    <Code>
                      {incident ? String(incident.reconnectScheduled) : 'n/a'}
                    </Code>
                  </Text>
                  <Text>
                    <Text as="span" color="fg.muted">
                      Jumlah event terkait:
                    </Text>{' '}
                    <Code>{eventCount}</Code>
                  </Text>
                  {notice?.reason ? (
                    <Text>
                      <Text as="span" color="fg.muted">
                        Jenis:
                      </Text>{' '}
                      <Code>{notice.reason}</Code>
                    </Text>
                  ) : null}
                </Stack>
                <Box fontSize="xs" color="fg.muted">
                  Diagnostic tetap tersimpan di sesi ini meski popup ditutup.
                </Box>
                {copyState === 'copied' ? (
                  <Text color="green.fg" fontSize="sm">
                    Diagnostic berhasil disalin.
                  </Text>
                ) : null}
                {copyState === 'failed' ? (
                  <Text color="red.fg" fontSize="sm">
                    Clipboard tidak tersedia. Buka DevTools lalu jalankan
                    <Code> window.__MILI_WS_DIAG__.copy()</Code> untuk menyalin
                    manual.
                  </Text>
                ) : null}
              </Stack>
            </Dialog.Body>
            <Dialog.Footer>
              <Button onClick={onCopy} colorPalette="red">
                Copy Diagnostic
              </Button>
              <Button variant="outline" onClick={onClose}>
                Tutup
              </Button>
            </Dialog.Footer>
            <Dialog.CloseTrigger />
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  );
}

export default WsIncidentModal;