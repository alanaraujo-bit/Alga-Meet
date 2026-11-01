/**
 * Common/leaked passwords that pass the length rule (≥ 10 characters; shorter ones already fail MIN_PASSWORD_LENGTH),
 * lowercase, compared case-insensitively by passwords.ts.
 *
 * Source: written by hand for this project from the patterns that dominate public leaked-password rankings (keyboard
 * walks, digit runs, "password"/"senha" + digits, iloveyou, football clubs, names + 123), with pt-BR variants. It is
 * not a copy of a third-party file, so there is no license to inherit (project license). Repeats ("aaaaaaaaaa",
 * "abcabcabca") and straight sequences ("abcdefghij", "9876543210") are caught by rule, not listed.
 * For wider coverage, replace with a public list filtered to ≥ 10 characters, e.g. SecLists
 * `Passwords/Common-Credentials/10-million-password-list-top-100000.txt` (MIT): see apps/server/README.md.
 */
const LIST = `
1234567890 0987654321 12345678910 1234567891 1234567899 12345678900 123456789000 1234554321 1234512345 1122334455
1111122222 1029384756 1357924680 2468013579 1472583690 3692581470 7894561230 1236547890 1597534862 1478963250
9638527410 1593574862 1231231234 1234123412 1212312121 2020202020 1010101010 1001001001 1234567812 0000011111
123456789a 123456789q 123456789z 1234567890a 1234567890q 123456789abc a123456789 a1234567890 q123456789 z123456789
aa12345678 aa123456789 abc1234567 abcd123456 abcde12345 abc123456789 abcd1234567 a1b2c3d4e5 1a2b3c4d5e a1s2d3f4g5
qwertyuiop qwertyuiop1 qwertyuiop123 qwertyuiop12 qwertyuiopasdfghjkl asdfghjkl1 asdfghjkl123 asdfghjkl12
zxcvbnm123 zxcvbnm1234 zxcvbnmasdf 1qaz2wsx3edc 1qaz2wsx3edc4rfv qazwsxedc123 qazwsxedcrfv qazwsxedcrfvtgb
1q2w3e4r5t 1q2w3e4r5t6y 1q2w3e4r5t6y7u 1q2w3e4r5t6y7u8i q1w2e3r4t5 q1w2e3r4t5y6 zaq12wsxcde3 1qazxsw23edc
123qweasdzxc qweasdzxc123 qwerty1234 qwerty12345 qwerty123456 qwertyqwerty qwerty123! qwer1234qwer 1234qwerasdf
1234qwerty 12345qwert 12345qwerty 123456qwerty qwert12345 qwertyuiop! asdf123456 asdfg12345 asdfqwerzxcv
password12 password123 password1234 password12345 password123! password1! passw0rd123 p@ssw0rd123 p@ssword123
p@ssw0rd12 passwordpassword mypassword mypassword1 mypassword123 newpassword newpassword1 secretpassword
password2020 password2021 password2022 password2023 password2024 password2025 password2026 changeme123
welcome123 welcome1234 welcome123! letmein123 letmein1234 administrator administrator1 adminadmin adminadmin1
admin12345 admin123456 admin1234567 rootroot123 testtest123 test123456 test1234567 guest12345 default123
iloveyou12 iloveyou123 iloveyou1234 iloveyou2 iloveyouforever iloveyou!! iloveu1234 loveyou123 lovelove12
princess12 princess123 football12 football123 football1234 basketball basketball1 basketball12 baseball12
baseball123 soccer1234 hockey1234 superman12 superman123 spiderman1 spiderman12 spiderman123 batman1234
batman12345 starwars12 starwars123 harrypotter harrypotter1 pokemon123 pokemon1234 minecraft1 minecraft12
minecraft123 fortnite123 roblox12345 playstation playstation1 playstation2 nintendo123 xbox360123 gaming1234
michael123 jennifer12 jennifer123 charlie123 jordan2323 jessica123 ashley1234 daniel1234 thomas1234 andrew1234
whatever12 whatever123 sunshine12 sunshine123 chocolate1 chocolate12 chocolate123 butterfly1 butterfly12
monkey1234 dragon1234 master1234 shadow1234 freedom123 computer12 computer123 internet12 internet123 samsung123
samsung1234 iphone1234 google1234 facebook123 instagram1 instagram123 whatsapp123 youtube123 linkedin123
liverpool1 liverpool12 liverpool123 manchester manchester1 manutd1234 arsenal123 chelsea123 barcelona1
barcelona12 barcelona123 realmadrid realmadrid1 juventus123 jesus12345 jesuschrist godisgood1 babygirl12
babygirl123 cookie1234 cheese1234 summer2020 summer2023 summer2024 winter2024 spring2024 autumn2024
senha12345 senha123456 senha1234567 senha12345678 senha123456789 senhasenha senhasenha1 senha1234! senha@123
minhasenha minhasenha1 minhasenha123 minhasenha12 senhaforte senhaforte1 senhaforte123 senhasegura senhasegura1
novasenha1 novasenha12 novasenha123 mudar12345 mudar123456 mudarsenha mudarsenha1 trocarsenha alterar123
alterar1234 acesso1234 acesso12345 acesso123456 entrar1234 entrar12345 usuario123 usuario1234 teste12345
teste123456 teste1234567 testeteste admin@1234 senha2020 senha2021 senha2022 senha2023 senha2024 senha2025
brasil1234 brasil12345 brasil123456 brasil2014 brasil2022 brasil2024 brasileiro brasileira saopaulo10
saopaulo123 riodejaneiro flamengo10 flamengo123 flamengo1234 flamengo1895 flamengo1981 flamengo2019
corinthians corinthians1 corinthians10 corinthians123 corinthians1910 corinthians2012 palmeiras1
palmeiras10 palmeiras123 palmeiras1914 fluminense fluminense1 vascodagama vascodagama1 internacional
gremio1234 gremio1903 cruzeiro10 cruzeiro123 botafogo10 botafogo123 santos1234 santosfc10 atleticomg
bahia12345 sportrecife fortaleza1 jesuscristo jesuscristo1 jesusteama jesusteama1 jesuseamor deusefiel1
deusefiel123 deuseamor1 deuseamor123 deusehfiel deuseomeupai obrigadodeus graçasadeus gracasadeus
teamo12345 teamo123456 teamomuito euteamo123 euteamo1234 euteamomuito amor123456 amor1234567 amoreterno
meuamor123 meuamor1234 meuamoreterno minhavida1 minhavida123 minhafamilia familia123 familia1234
princesa12 princesa123 gatinha123 gatinho123 cachorro123 vitoria123 felicidade felicidade1 saudade123
gabriel123 gabriel1234 matheus123 lucas12345 lucas123456 joao123456 maria12345 mariana123 juliana123
fernanda123 rafael1234 pedro12345 beatriz123 larissa123 leticia123 amanda1234 bruna12345 camila1234
eusoufoda1 eusoulindo eusoulinda vidaloka10 naosei1234 qualquercoisa tantofaz123 sla1234567 kkkkkkkkk1
abcdefgh12 abcdefg123 abcdefghi1 abc123abc123 1q2w3e4r5t! 123mudar123 abc@123456 a1b2c3d4e5f6 m1nh4s3nh4
`

export const COMMON_PASSWORDS: ReadonlySet<string> = new Set(LIST.split(/\s+/).filter(Boolean))
