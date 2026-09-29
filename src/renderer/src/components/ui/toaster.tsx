'use client';

import {
  Toaster as ChakraToaster,
  Portal,
  Spinner,
  Stack,
  Toast,
  createToaster,
} from '@chakra-ui/react';

export const toaster = createToaster({
  placement: 'top-end',
  pauseOnPageIdle: true,
  max: 5,
});

export function Toaster() {
  return (
    <Portal>
      <ChakraToaster toaster={toaster} insetInline={{ mdDown: '4' }}>
        {(toast) => (
          // Mobile: compact fit-content notification (content width with
          // viewport margin), tighter padding/gap/icon/type. Desktop (md+)
          // keeps the existing default look untouched.
          <Toast.Root
            width={{ base: 'auto', md: 'sm' }}
            maxWidth={{ base: 'calc(100vw - 32px)', md: 'sm' }}
            px={{ base: '4', md: undefined }}
            py={{ base: '2.5', md: undefined }}
            gap={{ base: '2.5', md: undefined }}
          >
            {toast.type === 'loading' ? (
              <Spinner size="sm" color="blue.solid" />
            ) : (
              <Toast.Indicator boxSize={{ base: '20px', md: undefined }} flexShrink={0} />
            )}
            <Stack gap="1" flex="1" minW="0" maxWidth="100%">
              {toast.title && (
                <Toast.Title
                  fontSize={{ base: '14px', md: undefined }}
                  lineHeight={{ base: '20px', md: undefined }}
                >
                  {toast.title}
                </Toast.Title>
              )}
              {toast.description && (
                <Toast.Description
                  fontSize={{ base: '14px', md: undefined }}
                  lineHeight={{ base: '20px', md: undefined }}
                >
                  {toast.description}
                </Toast.Description>
              )}
            </Stack>
            {toast.action && (
              <Toast.ActionTrigger>{toast.action.label}</Toast.ActionTrigger>
            )}
            {toast.meta?.closable && <Toast.CloseTrigger />}
          </Toast.Root>
        )}
      </ChakraToaster>
    </Portal>
  );
}
