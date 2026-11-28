/**
 * Root layout component for the whole application.
 * @since 2025-09-02
 * @author Michael Townsend <@continuities>
 */

import type { Metadata } from 'next';
import './globals.css';
import '@radix-ui/themes/styles.css';
import './theme-overrides.css';
import { ThemeProvider } from 'next-themes';
import Script from 'next/script';
import { NextIntlClientProvider } from 'next-intl';
import { Theme, Flex, Callout } from '@radix-ui/themes';
import NavigationFrame from '@/ui/navigation-frame';
import { currentUser, getCurrentEvent } from '@/session';
import { getTranslations } from 'next-intl/server';
import { getEventDateRangeDisplayText } from '@/utils/date';
import { userToVolunteer } from '@/lib/volunteer';
import { getPermissionsProfile } from '@/utils/permissions';
import { isTicketingEnabled } from '@/lib/ticketing';
import { userHasTicket } from '@/service/ticketing-service';
import { InfoCircledIcon } from '@radix-ui/react-icons';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('Metadata');
  const event = await getCurrentEvent();
  return {
    title: process.env.APP_NAME,
    description: t('description'),
    icons: event?.favicon ? [{ rel: 'icon', url: event.favicon }] : undefined
  };
}

export default async function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  const t = await getTranslations('Layout');
  const user = await currentUser();
  const event = await getCurrentEvent();

  const navBarTitle = event ? event.name : process.env.APP_NAME;
  const navBarSubtitle = event ? getEventDateRangeDisplayText({ event }) : undefined;

  const showNoTicketWarning =
    isTicketingEnabled() && event && (!user || !(await userHasTicket(user.id, event.id)));

  const mainContent = (
    <Flex asChild direction="column" p="4">
      <main>
        {showNoTicketWarning && (
          <Callout.Root>
            <Callout.Icon>
              <InfoCircledIcon />
            </Callout.Icon>
            <Callout.Text>{t('needTicket', { eventName: event!.name })}</Callout.Text>
          </Callout.Root>
        )}
        {children}
      </main>
    </Flex>
  );

  return (
    <html lang="en" suppressHydrationWarning>
      <body suppressHydrationWarning>
        <NextIntlClientProvider>
          <ThemeProvider
            attribute="class"
            defaultTheme={(process.env.DEFAULT_THEME as ThemeMode) || 'system'}
          >
            <Theme accentColor="violet">
              {user ? (
                <NavigationFrame
                  title={navBarTitle}
                  subtitle={navBarSubtitle}
                  currentUser={userToVolunteer(user, getPermissionsProfile(user))}
                >
                  {mainContent}
                </NavigationFrame>
              ) : (
                mainContent
              )}
            </Theme>
          </ThemeProvider>
        </NextIntlClientProvider>
        {process.env.UMAMI_WEBSITE_ID && (
          <Script
            async
            strategy="lazyOnload"
            src="https://cloud.umami.is/script.js"
            data-website-id={process.env.UMAMI_WEBSITE_ID}
          />
        )}
      </body>
    </html>
  );
}
