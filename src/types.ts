export type Network = 'BTC' | 'ETH'

export type Wallet = {
  id: string
  network: Network
  address: string
  balance: string
  mnemonic: string
}
