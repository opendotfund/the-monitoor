import React, { useState, useCallback } from 'react';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { useWalletModal } from '@solana/wallet-adapter-react-ui';
import { Transaction, SystemProgram, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';

export function CoffeeButton({ className }: { className?: string }) {
  const { connection } = useConnection();
  const { publicKey, sendTransaction, connected } = useWallet();
  const { setVisible } = useWalletModal();
  const [loading, setLoading] = useState(false);

  const handleTip = useCallback(async () => {
    if (!connected || !publicKey) {
      setVisible(true);
      return;
    }

    try {
      setLoading(true);
      const recipient = new PublicKey("CRdAJC5JriJ64oHwqC5EJFEWr4DrcfsFeK4YDk17tLRD");
      const transaction = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: publicKey,
          toPubkey: recipient,
          lamports: Math.round(0.066 * LAMPORTS_PER_SOL), // ~$10
        })
      );

      const {
        context: { slot: minContextSlot },
        value: { blockhash, lastValidBlockHeight }
      } = await connection.getLatestBlockhashAndContext();

      transaction.recentBlockhash = blockhash;
      transaction.feePayer = publicKey;

      const signature = await sendTransaction(transaction, connection, { minContextSlot });
      console.log("Transaction sent:", signature);
      
      await connection.confirmTransaction({ blockhash, lastValidBlockHeight, signature });
      console.log("Transaction confirmed!");
      
      alert("Thank you for the coffee! ☕\\nTx: " + signature);
    } catch (error: any) {
      console.error("Tip failed", error);
      alert("Transaction failed: " + (error?.message || "Unknown error"));
    } finally {
      setLoading(false);
    }
  }, [connected, publicKey, connection, sendTransaction, setVisible]);

  return (
    <button
      onClick={handleTip}
      disabled={loading}
      className={className || "border border-[#1f2932] text-[#d7e0ea] hover:border-[#f0b429] hover:text-[#f0b429] px-4 py-2 text-[12px] font-bold tracking-widest transition-colors flex items-center gap-2"}
    >
      {loading ? "SENDING..." : (connected ? "☕ SEND $10 SOL" : "☕ BUY ME A COFFEE")}
    </button>
  );
}
