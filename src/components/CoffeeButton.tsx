import React, { useState, useCallback } from 'react';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { Transaction, SystemProgram, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';

export function CoffeeButton({ className }: { className?: string }) {
  const { connection } = useConnection();
  const { publicKey, sendTransaction, connected } = useWallet();
  const [loading, setLoading] = useState(false);

  const handleTip = useCallback(async () => {
    if (!connected || !publicKey) {
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
  }, [connected, publicKey, connection, sendTransaction]);

  return (
    <div className="flex items-center gap-2">
      <WalletMultiButton 
        style={{
          backgroundColor: 'transparent',
          border: '1px solid #1f2932',
          color: '#d7e0ea',
          padding: '0.5rem 1rem',
          fontSize: '12px',
          fontWeight: 'bold',
          letterSpacing: '0.1em',
          height: 'auto',
          lineHeight: 'inherit',
          borderRadius: '0.25rem',
          transition: 'all 0.2s',
          fontFamily: 'inherit'
        }}
      />
      {connected && (
        <button
          onClick={handleTip}
          disabled={loading}
          className={className || "border border-[#3ee08a] text-[#3ee08a] hover:bg-[#3ee08a] hover:text-[#0b0f14] px-4 py-2 text-[12px] font-bold tracking-widest transition-colors flex items-center gap-2"}
        >
          {loading ? "SENDING..." : "☕ SEND $10 TIP"}
        </button>
      )}
    </div>
  );
}
