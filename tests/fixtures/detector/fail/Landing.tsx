export function Landing() {
  return (
    <main className="bg-black text-white">
      <p className="text-xs uppercase tracking-widest text-gray-400">Features</p>
      <h1 className="bg-gradient-to-r from-purple-500 to-cyan-500 bg-clip-text text-transparent text-7xl">
        Unlock the power of your data
      </h1>
      <div className="border-l-4 border-blue-500 p-4 transition-all">
        <span>🚀</span>
        <button>Submit</button>
      </div>
      <div className="backdrop-blur-md bg-white/10 p-4" onClick={() => undefined}>
        Design · Build · Ship
      </div>
      <img src="/hero.png" />
    </main>
  );
}
