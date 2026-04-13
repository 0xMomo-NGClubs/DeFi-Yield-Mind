import { createConfig, http } from 'wagmi'
import { mainnet, arbitrum, base, optimism, polygon, bsc } from 'wagmi/chains'
import { injected, walletConnect } from 'wagmi/connectors'

export const wagmiConfig = createConfig({
  chains: [mainnet, arbitrum, base, optimism, polygon, bsc],
  connectors: [
    injected(),
    walletConnect({
      projectId: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || 'demo',
    }),
  ],
  transports: {
    [mainnet.id]: http(),
    [arbitrum.id]: http(),
    [base.id]: http(),
    [optimism.id]: http(),
    [polygon.id]: http(),
    [bsc.id]: http(),
  },
})
