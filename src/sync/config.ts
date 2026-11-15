// Public address of the Nhost project. These two values are not secrets: every visitor's
// browser needs them to reach the backend, and access is controlled by sign-in and by the
// table permissions on the server. Leave the subdomain empty to build the app without sync.
export const NHOST = {
  subdomain: '',
  region: 'eu-central-1',
  /** Shown to the user in the account section. */
  label: 'Nhost, Frankfurt',
};
