/* =========================================================
   CampusCare · Monitoreo físico con Arduino UNO
   ---------------------------------------------------------
   Conexiones:
     Módulo de luz (MH-Sensor-Series)  VCC->5V  GND->GND  AO->A0  DO->D2
     Módulo de flama                   VCC->5V  GND->GND  AO->A1  DO->D3
     Potenciómetro B10K                extremos->5V y GND, centro->A2
     Opcionales: LED amarillo D8, LED rojo D9 (cada uno con 220 ohm), buzzer D10

   Envía por USB (9600 baudios), 4 veces por segundo, una línea JSON
   con los valores CRUDOS (0 a 1023). La página CampusCare los convierte
   a porcentaje con su calibración:
     {"luz":312,"oscuro":0,"flama":0,"flamaRaw":1010,"agua":512}

   Recibe comandos de una letra desde la página:
     S = silenciar la alarma     A = activar la alarma
     T = probar LEDs y buzzer    P = responder "pong" (prueba de conexión)
   ========================================================= */

const int PIN_LUZ_AO   = A0;
const int PIN_FLAMA_AO = A1;
const int PIN_AGUA     = A2;
const int PIN_LUZ_DO   = 2;   // HIGH con poca luz (ajusta el tornillo azul del módulo)
const int PIN_FLAMA_DO = 3;   // LOW cuando detecta flama (ajusta el tornillo azul del módulo)

const int LED_LUZ   = 8;
const int LED_FLAMA = 9;
const int BUZZER    = 10;

bool alarmaActiva = true;
unsigned long pruebaHasta = 0;

void setup() {
  Serial.begin(9600);
  pinMode(PIN_LUZ_DO, INPUT);
  pinMode(PIN_FLAMA_DO, INPUT);
  pinMode(LED_LUZ, OUTPUT);
  pinMode(LED_FLAMA, OUTPUT);
  pinMode(BUZZER, OUTPUT);
}

void leerComandos() {
  while (Serial.available() > 0) {
    char c = Serial.read();
    if (c == 'S') alarmaActiva = false;
    else if (c == 'A') alarmaActiva = true;
    else if (c == 'T') pruebaHasta = millis() + 1500;
    else if (c == 'P') Serial.println("{\"pong\":1}");
  }
}

void loop() {
  leerComandos();

  int luz      = analogRead(PIN_LUZ_AO);    // más alto = más oscuro
  int flamaRaw = analogRead(PIN_FLAMA_AO);  // más bajo = flama más cerca
  int agua     = analogRead(PIN_AGUA);      // 0 a 1023 según la perilla
  bool oscuro  = digitalRead(PIN_LUZ_DO) == HIGH;
  bool flama   = digitalRead(PIN_FLAMA_DO) == LOW;

  // Indicadores físicos
  bool prueba = millis() < pruebaHasta;
  digitalWrite(LED_LUZ,   (oscuro || prueba) ? HIGH : LOW);
  digitalWrite(LED_FLAMA, (flama  || prueba) ? HIGH : LOW);
  if ((flama && alarmaActiva) || prueba) tone(BUZZER, 2000, 120);

  Serial.print("{\"luz\":");       Serial.print(luz);
  Serial.print(",\"oscuro\":");    Serial.print(oscuro ? 1 : 0);
  Serial.print(",\"flama\":");     Serial.print(flama ? 1 : 0);
  Serial.print(",\"flamaRaw\":");  Serial.print(flamaRaw);
  Serial.print(",\"agua\":");      Serial.print(agua);
  Serial.print(",\"alarma\":");    Serial.print(alarmaActiva ? 1 : 0);
  Serial.println("}");

  delay(250);
}
