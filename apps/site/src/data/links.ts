// Links de download. A release pública mais recente no GitHub; PUBLIC_DOWNLOAD_URL no build sobrepõe.
export const releasesUrl = 'https://github.com/alanaraujo-bit/Alga-Meet/releases';
export const downloadUrl: string = import.meta.env.PUBLIC_DOWNLOAD_URL || `${releasesUrl}/latest/download/AlgaMeet-Setup.exe`;
// Texto honesto que acompanha o botão: o instalador ainda não tem assinatura digital.
export const downloadNote = "Windows 10/11 · beta fechado · ainda sem assinatura digital (o Windows pode avisar 'editor desconhecido')";
