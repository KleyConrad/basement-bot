// // ============================================================
// // Anti-voz: reduz a SUA própria voz no som da transmissão.
// //
// // Como funciona (resumo):
// //  - Entrada 0: o som da transmissão (que traz a sua voz atrasada,
// //    porque ela passou pelo Discord de quem transmite).
// //  - Entrada 1: o seu microfone (só como referência; nada é gravado
// //    nem enviado para ninguém).
// //  - O programa descobre sozinho o atraso entre o microfone e a
// //    transmissão e, faixa de frequência por faixa, abaixa só o que
// //    é a sua voz. O resto do som (jogo, música, notificações, voz
// //    dos outros) passa quase intacto.
// //  - Se não tiver certeza do atraso, não mexe em nada.
// // ============================================================

// const N = 1024; // tamanho da janela de análise
// const H = 256; // avanço entre janelas (75% de sobreposição)
// const HALF = N / 2;
// const FS = sampleRate;
// const FR = FS / H; // janelas por segundo

// // Faixas de frequência (aprox. escala Bark)
// const BORDAS_BASE = [
//   0, 100, 200, 300, 400, 510, 630, 770, 920, 1080, 1270, 1480, 1720, 2000, 2320,
//   2700, 3150, 3700, 4400, 5300, 6400, 7700, 9500, 12000, 15500,
// ];

// // Ajustes (valores calibrados na simulação)
// const ATRASO_MIN_S = 0.08; // não procura atrasos menores (evita eco do alto-falante)
// const ATRASO_MAX_S = 1.6;
// const MEMORIA_CORR_S = 4; // quanto tempo a correlação "lembra"
// const LIMIAR_RHO = 0.12; // correlação mínima para aceitar um atraso
// const LIMIAR_Z = 5; // o pico precisa se destacar do resto
// const BETA = 2;  // força da redução
// const PISO_GANHO = 0.1; // nunca abaixa mais que ~15 dB

// function criarFFT(n) {
//   const niveis = Math.round(Math.log2(n));
//   const rev = new Uint16Array(n);
//   for (let i = 0; i < n; i++) {
//     let r = 0;
//     for (let b = 0; b < niveis; b++) if (i & (1 << b)) r |= 1 << (niveis - 1 - b);
//     rev[i] = r;
//   }
//   const cos = new Float64Array(n / 2);
//   const sin = new Float64Array(n / 2);
//   for (let i = 0; i < n / 2; i++) {
//     cos[i] = Math.cos((2 * Math.PI * i) / n);
//     sin[i] = Math.sin((2 * Math.PI * i) / n);
//   }

//   return function fft(re, im, inversa) {
//     for (let i = 0; i < n; i++) {
//       const j = rev[i];
//       if (j > i) {
//         let t = re[i]; re[i] = re[j]; re[j] = t;
//         t = im[i]; im[i] = im[j]; im[j] = t;
//       }
//     }
//     for (let tam = 2; tam <= n; tam <<= 1) {
//       const meio = tam >> 1;
//       const passo = n / tam;
//       for (let ini = 0; ini < n; ini += tam) {
//         for (let j = 0, k = 0; j < meio; j++, k += passo) {
//           const wr = cos[k];
//           const wi = inversa ? sin[k] : -sin[k];
//           const a = ini + j;
//           const b = a + meio;
//           const tr = re[b] * wr - im[b] * wi;
//           const ti = re[b] * wi + im[b] * wr;
//           re[b] = re[a] - tr;
//           im[b] = im[a] - ti;
//           re[a] += tr;
//           im[a] += ti;
//         }
//       }
//     }
//     if (inversa) {
//       for (let i = 0; i < n; i++) {
//         re[i] /= n;
//         im[i] /= n;
//       }
//     }
//   };
// }

// class AntiVoz {
//   constructor() {
//     this.fft = criarFFT(N);

//     // Janela raiz de Hann (análise e síntese)
//     this.janela = new Float64Array(N);
//     for (let i = 0; i < N; i++) {
//       this.janela[i] = Math.sqrt(0.5 * (1 - Math.cos((2 * Math.PI * i) / N)));
//     }

//     // Faixas
//     const bordas = BORDAS_BASE.filter((f) => f < FS / 2 - 200);
//     bordas.push(FS / 2 + 1);
//     this.nb = bordas.length - 1;
//     const hzBin = FS / N;
//     this.bandaDoBin = new Uint8Array(HALF + 1);
//     const centros = [];
//     for (let b = 0; b < this.nb; b++) centros.push((bordas[b] + bordas[b + 1]) / 2);
//     for (let k = 0; k <= HALF; k++) {
//       const f = k * hzBin;
//       let b = 0;
//       while (b < this.nb - 1 && f >= bordas[b + 1]) b++;
//       this.bandaDoBin[k] = b;
//     }
//     // interpolação de ganho entre centros de faixa
//     this.binB0 = new Uint8Array(HALF + 1);
//     this.binFrac = new Float64Array(HALF + 1);
//     for (let k = 0; k <= HALF; k++) {
//       const f = k * hzBin;
//       if (f <= centros[0]) { this.binB0[k] = 0; this.binFrac[k] = 0; continue; }
//       if (f >= centros[this.nb - 1]) { this.binB0[k] = this.nb - 1; this.binFrac[k] = 0; continue; }
//       let b = 0;
//       while (b < this.nb - 2 && f >= centros[b + 1]) b++;
//       this.binB0[k] = b;
//       this.binFrac[k] = (f - centros[b]) / (centros[b + 1] - centros[b]);
//     }
//     // faixas da voz (300 Hz a 3,4 kHz) usadas para achar o atraso
//     this.faixasVoz = [];
//     for (let b = 0; b < this.nb; b++) if (centros[b] >= 300 && centros[b] <= 3400) this.faixasVoz.push(b);

//     // Buffers de entrada/saída
//     this.histL = new Float32Array(N);
//     this.histR = new Float32Array(N);
//     this.histM = new Float32Array(N);
//     this.colaL = new Float32Array(N);
//     this.colaR = new Float32Array(N);
//     this.preenchido = 0;

//     this.re = new Float64Array(N);
//     this.im = new Float64Array(N);
//     this.mre = new Float64Array(N);
//     this.mim = new Float64Array(N);

//     // Histórico do microfone (potência limpa por faixa)
//     this.LMIN = Math.round(ATRASO_MIN_S * FR);
//     this.LMAX = Math.round(ATRASO_MAX_S * FR);
//     this.R = this.LMAX + 8;
//     this.anelX = new Float32Array(this.R * this.nb);
//     this.anelXk = new Float32Array(this.R * (HALF + 1)); // potência limpa por bin
//     this.pmK = new Float64Array(HALF + 1); // potência do microfone por bin (suavizada)
//     this.pisoK = new Float64Array(HALF + 1).fill(-1);
//     this.ganhoK = new Float64Array(HALF + 1).fill(1);
//     this.Sk = new Float64Array(HALF + 1);
//     this.XrefK = new Float64Array(HALF + 1);
//     this.quadro = 0;

//     this.pisoRuido = new Float64Array(this.nb).fill(-1);
//     this.pmSuave = new Float64Array(this.nb);

//     const nvb = this.faixasVoz.length;
//     this.anelEmB = new Float32Array(this.R * nvb);
//     this.lpEmB = new Float64Array(nvb);
//     this.lpEsB = new Float64Array(nvb);
//     this.varEsB = new Float64Array(nvb).fill(1e-12);
//     this.esc = new Float64Array(nvb);
//     this.corr = new Float64Array(this.LMAX + 1);
//     this.lambda = Math.exp(-1 / (FR * MEMORIA_CORR_S));
//     this.energiaEs = 0;
//     this.energiaEm = 0;

//     this.atraso = -1; // em janelas
//     this.confianca = 0;

//     this.acoplamento = new Float64Array(this.nb).fill(-1);
//     this.taxaC = 1 / (FR * 6);
//     this.mS = new Float64Array(this.nb);
//     this.mX = new Float64Array(this.nb);
//     this.mSX = new Float64Array(this.nb);
//     this.mXX = new Float64Array(this.nb);
//     this.ganhoSuave = new Float64Array(this.nb).fill(1);
//     this.Sb = new Float64Array(this.nb);
//     this.Pm = new Float64Array(this.nb);
//     this.Xref = new Float64Array(this.nb);
//     this.ganhoBanda = new Float64Array(this.nb);

//     // fila de saída (começa com 128 amostras de silêncio)
//     this.fila = { l: new Float32Array(H * 8), r: new Float32Array(H * 8) };
//     this.filaLer = 0;
//     this.filaEsc = 128;

//     this.forca = 1; // 0 = desligado
//     this.reducaoDb = 0;
//     this.depurar = null; // usado só nos testes
//   }

//   // Recebe 128 amostras (L, R, microfone) e devolve 128 prontas
//   // por meio dos arrays de saída.
//   processar(l, r, m, saidaL, saidaR) {
//     const n = l.length;
//     if (this.preenchido === 0) {
//       this.histL.copyWithin(0, H);
//       this.histR.copyWithin(0, H);
//       this.histM.copyWithin(0, H);
//     }
//     const base = N - H + this.preenchido;
//     for (let i = 0; i < n; i++) {
//       this.histL[base + i] = l[i];
//       this.histR[base + i] = r[i];
//       this.histM[base + i] = m ? m[i] : 0;
//     }
//     this.preenchido += n;

//     if (this.preenchido >= H) {
//       this.preenchido = 0;
//       this.quadroProcessar();
//     }

//     // devolve as amostras prontas (atraso fixo de H amostras de fila)
//     for (let i = 0; i < n; i++) {
//       saidaL[i] = this.fila.l[this.filaLer];
//       saidaR[i] = this.fila.r[this.filaLer];
//       this.filaLer = (this.filaLer + 1) % this.fila.l.length;
//     }
//   }

//   quadroProcessar() {
//     const { re, im, mre, mim, janela, fft, nb } = this;

//     for (let i = 0; i < N; i++) {
//       re[i] = this.histL[i] * janela[i];
//       im[i] = this.histR[i] * janela[i];
//       mre[i] = this.histM[i] * janela[i];
//       mim[i] = 0;
//     }
//     fft(re, im, false);
//     fft(mre, mim, false);

//     // potência por faixa: transmissão (mistura mono) e microfone
//     const Sb = this.Sb;
//     const Pm = this.Pm;
//     Sb.fill(0);
//     Pm.fill(0);
//     this.Sk[0] = 0;
//     for (let k = 1; k <= HALF; k++) {
//       const kk = (N - k) & (N - 1);
//       const flr = (re[k] + re[kk]) / 2;
//       const fli = (im[k] - im[kk]) / 2;
//       const frr = (im[k] + im[kk]) / 2;
//       const fri = -(re[k] - re[kk]) / 2;
//       const mr = (flr + frr) / 2;
//       const mi = (fli + fri) / 2;
//       const b = this.bandaDoBin[k];
//       const ps = mr * mr + mi * mi;
//       const pmk = mre[k] * mre[k] + mim[k] * mim[k];
//       this.Sk[k] = ps;
//       Sb[b] += ps;
//       Pm[b] += pmk;
//       // piso de ruído e potência limpa por bin
//       this.pmK[k] += 0.15 * (pmk - this.pmK[k]);
//       if (this.pisoK[k] < 0 || this.pmK[k] < this.pisoK[k]) this.pisoK[k] = this.pmK[k] + 1e-14;
//       else this.pisoK[k] *= 1.0002;
//       this.anelXk[(this.quadro % this.R) * (HALF + 1) + k] = Math.max(0, pmk - 2 * this.pisoK[k]);
//     }

//     // piso de ruído do microfone (mínimo móvel) e potência "limpa"
//     const t = this.quadro;
//     const pos = (t % this.R) * nb;
//     let somaX = 0;
//     let somaS = 0;
//     for (let b = 0; b < nb; b++) {
//       this.pmSuave[b] += 0.15 * (Pm[b] - this.pmSuave[b]);
//       if (this.pisoRuido[b] < 0) this.pisoRuido[b] = this.pmSuave[b] + 1e-12;
//       else if (this.pmSuave[b] < this.pisoRuido[b]) this.pisoRuido[b] = this.pmSuave[b] + 1e-12;
//       else this.pisoRuido[b] *= 1.0002;
//       const limpo = Math.max(0, Pm[b] - 1.5 * this.pisoRuido[b]);
//       this.anelX[pos + b] = limpo;
//     }
//     for (const b of this.faixasVoz) {
//       somaX += this.anelX[pos + b];
//       somaS += Sb[b];
//     }

//     // envelopes por faixa (sem a parte lenta) e correlação para achar o atraso.
//     // Usar várias faixas ao mesmo tempo evita "achar" um atraso que não existe.
//     const nvb = this.faixasVoz.length;
//     const lam = this.lambda;
//     let somaEm2 = 0;
//     for (let j = 0; j < nvb; j++) {
//       const b = this.faixasVoz[j];
//       const emb = Math.sqrt(this.anelX[pos + b]);
//       const esb = Math.sqrt(Sb[b]);
//       this.lpEmB[j] += 0.01 * (emb - this.lpEmB[j]);
//       this.lpEsB[j] += 0.01 * (esb - this.lpEsB[j]);
//       const emc = emb - this.lpEmB[j];
//       const esc0 = esb - this.lpEsB[j];
//       this.varEsB[j] = 0.995 * this.varEsB[j] + 0.005 * esc0 * esc0;
//       this.esc[j] = esc0 / Math.sqrt(this.varEsB[j] + 1e-18);
//       this.anelEmB[(t % this.R) * nvb + j] = emc;
//       somaEm2 += emc * emc;
//     }
//     this.energiaEs = lam * this.energiaEs + nvb;
//     this.energiaEm = lam * this.energiaEm + somaEm2;

//     const corr = this.corr;
//     let melhor = this.LMIN;
//     let melhorV = -Infinity;
//     for (let lag = this.LMIN; lag <= this.LMAX; lag++) {
//       const base = ((t - lag + this.R * 2) % this.R) * nvb;
//       let acc = 0;
//       if (t - lag >= 0) for (let j = 0; j < nvb; j++) acc += this.esc[j] * this.anelEmB[base + j];
//       const v = lam * corr[lag] + acc;
//       corr[lag] = v;
//       if (v > melhorV) { melhorV = v; melhor = lag; }
//     }
//     const den = Math.sqrt(this.energiaEs * this.energiaEm) + 1e-18;
//     const rho = melhorV / den;

//     // força do pico em relação ao "ruído" dos outros atrasos
//     let s2 = 0;
//     let cont = 0;
//     for (let lag = this.LMIN; lag <= this.LMAX; lag++) {
//       if (Math.abs(lag - melhor) > 12) {
//         const v = corr[lag] / den;
//         s2 += v * v;
//         cont++;
//       }
//     }
//     const sigma = Math.sqrt(s2 / Math.max(1, cont)) + 1e-9;
//     const z = rho / sigma;

//     if (this.atraso < 0) {
//       if (rho > LIMIAR_RHO && z > LIMIAR_Z && t > this.LMAX) this.atraso = melhor;
//     } else {
//       const rhoAtual = corr[this.atraso] / den;
//       if (Math.abs(melhor - this.atraso) <= 3) this.atraso = melhor;
//       else if (rho > 1.3 * rhoAtual + 0.02 && z > LIMIAR_Z) this.atraso = melhor;
//     }
//     this.z = z;
//     this.rho = rho;
//     if (this.atraso >= 0) {
//       const rhoAtual = corr[this.atraso] / den;
//       const zAtual = rhoAtual / sigma;
//       this.confianca = Math.max(0, Math.min(1, (zAtual - LIMIAR_Z * 0.6) / (LIMIAR_Z * 0.8)));
//       if (zAtual < LIMIAR_Z * 0.5 || rhoAtual < LIMIAR_RHO * 0.5) this.atraso = -1;
//     } else {
//       this.confianca = 0;
//     }

//     // potência de referência (microfone no instante certo) por faixa
//     const Xref = this.Xref;
//     if (this.atraso >= 0) {
//       const d0 = this.atraso;
//       for (let b = 0; b < nb; b++) {
//         const a = this.anelX[((t - d0 + this.R) % this.R) * nb + b];
//         const c = this.anelX[((t - d0 - 1 + this.R) % this.R) * nb + b];
//         const e = this.anelX[((t - d0 + 1 + this.R) % this.R) * nb + b];
//         Xref[b] = 0.5 * a + 0.25 * (c + e);
//       }
//       const K1 = HALF + 1;
//       const ia = ((t - d0 + this.R) % this.R) * K1;
//       const ic = ((t - d0 - 1 + this.R) % this.R) * K1;
//       const ie = ((t - d0 + 1 + this.R) % this.R) * K1;
//       for (let k = 0; k <= HALF; k++) {
//         this.XrefK[k] = 0.5 * this.anelXk[ia + k] + 0.25 * (this.anelXk[ic + k] + this.anelXk[ie + k]);
//       }
//     } else {
//       Xref.fill(0);
//       this.XrefK.fill(0);
//     }

//     // acoplamento (quanto da voz aparece na transmissão) e máscara
//     const conf = this.confianca * this.forca;
//     let totalAntes = 0;
//     let totalDepois = 0;
//     // O acoplamento (quanto da sua voz aparece na transmissão) é a inclinação
//     // da reta "potência da transmissão x potência do microfone". O som do
//     // jogo não acompanha a sua fala, então não atrapalha essa conta.
//     if (this.atraso >= 0 && this.confianca > 0.2) {
//       const lc = this.taxaC;
//       for (let b = 0; b < nb; b++) {
//         const xr = Xref[b];
//         const sb = Sb[b];
//         this.mS[b] += lc * (sb - this.mS[b]);
//         this.mX[b] += lc * (xr - this.mX[b]);
//         this.mSX[b] += lc * (sb * xr - this.mSX[b]);
//         this.mXX[b] += lc * (xr * xr - this.mXX[b]);
//         const varX = this.mXX[b] - this.mX[b] * this.mX[b];
//         const cov = this.mSX[b] - this.mS[b] * this.mX[b];
//         if (this.mXX[b] > 1e-20 && varX > 0.1 * this.mXX[b]) {
//           this.acoplamento[b] = Math.max(0, cov / varX);
//         }
//       }
//     }

//     // máscara por bin: tira só a potência prevista da sua voz em cada frequência
//     const K = HALF;
//     const Sk = this.Sk;
//     const Xk = this.XrefK;
//     let total0 = 0;
//     let total1 = 0;
//     for (let k = 1; k <= K; k++) {
//       const g = this.acoplamento[this.bandaDoBin[k]];
//       const ks0 = Math.max(1, k - 1);
//       const ks1 = Math.min(K, k + 1);
//       const sm = (Sk[ks0] + Sk[k] + Sk[ks1]) / 3;
//       const xm = (Xk[ks0] + Xk[k] + Xk[ks1]) / 3;
//       let w = 1;
//       if (g >= 0 && conf > 0 && xm > 0) {
//         w = 1 - (BETA * conf * g * xm) / (sm + 1e-20);
//         w = Math.max(PISO_GANHO * PISO_GANHO, Math.min(1, w));
//       }
//       const alvo = Math.sqrt(w);
//       const gs = this.ganhoK[k];
//       this.ganhoK[k] = gs + (alvo < gs ? 0.7 : 0.25) * (alvo - gs);
//       const bandaVoz = k * (FS / N) >= 300 && k * (FS / N) <= 3400;
//       if (bandaVoz) {
//         total0 += Sk[k];
//         total1 += Sk[k] * this.ganhoK[k] * this.ganhoK[k];
//       }
//     }
//     this.ganhoK[0] = this.ganhoK[1];
//     const instante = 10 * Math.log10((total0 + 1e-20) / (total1 + 1e-20));
//     this.reducaoDb += 0.05 * (instante - this.reducaoDb);

//     // aplica o ganho (simétrico) e volta para o tempo
//     const gk = this.ganhoK;
//     for (let k = 0; k <= HALF; k++) {
//       re[k] *= gk[k];
//       im[k] *= gk[k];
//       if (k > 0 && k < HALF) {
//         re[N - k] *= gk[k];
//         im[N - k] *= gk[k];
//       }
//     }
//     if (this.depurar) this.depurar(t, gk, this.atraso);
//     fft(re, im, true);

//     for (let i = 0; i < N; i++) {
//       this.colaL[i] += re[i] * janela[i] * 0.5;
//       this.colaR[i] += im[i] * janela[i] * 0.5;
//     }
//     // primeiras H amostras estão prontas
//     const tam = this.fila.l.length;
//     for (let i = 0; i < H; i++) {
//       this.fila.l[this.filaEsc] = this.colaL[i];
//       this.fila.r[this.filaEsc] = this.colaR[i];
//       this.filaEsc = (this.filaEsc + 1) % tam;
//     }
//     this.colaL.copyWithin(0, H);
//     this.colaR.copyWithin(0, H);
//     this.colaL.fill(0, N - H);
//     this.colaR.fill(0, N - H);

//     this.quadro++;
//   }

//   estado() {
//     return {
//       atrasoMs: this.atraso >= 0 ? Math.round((this.atraso / FR) * 1000) : null,
//       confianca: this.confianca,
//       reducaoDb: this.reducaoDb,
//     };
//   }
// }

// if (typeof AudioWorkletProcessor !== 'undefined') {
//   class AntiVozProcessor extends AudioWorkletProcessor {
//     constructor() {
//       super();
//       this.nucleo = new AntiVoz();
//       this.vazioL = new Float32Array(128);
//       this.contador = 0;
//       this.port.onmessage = (e) => {
//         if (typeof e.data?.forca === 'number') this.nucleo.forca = e.data.forca;
//       };
//     }

//     process(entradas, saidas) {
//       const saida = saidas[0];
//       const ent = entradas[0];
//       const mic = entradas[1];
//       const n = saida[0].length;

//       if (!ent || ent.length === 0) {
//         // sem som da transmissão ainda: silêncio
//         for (const canal of saida) canal.fill(0);
//         return true;
//       }

//       const l = ent[0];
//       const r = ent[1] || ent[0];
//       const m = mic && mic.length > 0 ? mic[0] : null;
//       const saidaR = saida[1] || saida[0];

//       this.nucleo.processar(l, r, m, saida[0], saidaR);

//       this.contador += n;
//       if (this.contador >= FS / 2) {
//         this.contador = 0;
//         this.port.postMessage(this.nucleo.estado());
//       }
//       return true;
//     }
//   }

//   registerProcessor('anti-voz', AntiVozProcessor);
// }

// if (typeof module !== 'undefined') module.exports = { AntiVoz, FS, H, N, FR };