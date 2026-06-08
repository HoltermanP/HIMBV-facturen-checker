/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    // Niet bundelen maar als Node-modules laden (gebruiken net-sockets).
    serverComponentsExternalPackages: ['nodemailer', 'imapflow'],
  },
};

export default nextConfig;
