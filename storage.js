const multer = require('multer');

// Konfiguracja Multera - limity i pamięć podręczna (do 8 MB, obsługa JPG, PNG itp.)
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 8 * 1024 * 1024 }, // Limit 8 MB (dobre dla Discorda i Firestore)
    fileFilter: (req, file, cb) => {
        // Akceptujemy tylko obrazy lub pliki graficzne/dokumenty w razie potrzeby
        if (file.mimetype.startsWith('image/') || file.mimetype === 'application/pdf') {
            cb(null, true);
        } else {
            cb(new Error('Dozwolone są tylko pliki graficzne (JPG, PNG itp.) lub PDF!'), false);
        }
    }
});

/**
 * Funkcja pomocnicza przetwarzająca plik przesłany przez formularz na format Base64 
 * gotowy do zapisu w bazie danych Firebase.
 */
function processUploadedFile(req) {
    if (req.file) {
        // Konwersja bufora pliku na ciąg Base64 z zachowaniem typu MIME (np. image/jpeg)
        const b64 = Buffer.from(req.file.buffer).toString('base64');
        return `data:${req.file.mimetype};base64,${b64}`;
    }
    // Jeśli pliku nie wgrano, zwracamy ewentualny podany link URL
    return req.body.ticketImageURL || '';
}

/**
 * Uniwersalny middleware Express do obsługi błędów Multera (np. za duży plik)
 */
function handleUploadMiddleware(fieldName) {
    return (req, res, next) => {
        upload.single(fieldName)(req, res, function (err) {
            if (err instanceof multer.MulterError) {
                if (err.code === 'LIMIT_FILE_SIZE') {
                    return res.status(400).send(`
                        <div style="font-family: Arial; background: #313338; color: #fff; text-align: center; padding: 50px;">
                            <h2 style="color: #f23f43;">❌ Błąd: Plik jest za duży!</h2>
                            <p>Maksymalny rozmiar pliku to 8 MB.</p>
                            <a href="/dashboard" style="color: #5865F2; font-weight: bold; text-decoration: none;">Wróć do panelu</a>
                        </div>
                    `);
                }
                return res.status(400).send(`
                    <div style="font-family: Arial; background: #313338; color: #fff; text-align: center; padding: 50px;">
                        <h2 style="color: #f23f43;">❌ Błąd przesyłania pliku:</h2>
                        <p>${err.message}</p>
                        <a href="/dashboard" style="color: #5865F2; font-weight: bold; text-decoration: none;">Wróć do panelu</a>
                    </div>
                `);
            } else if (err) {
                return res.status(400).send(`
                    <div style="font-family: Arial; background: #313338; color: #fff; text-align: center; padding: 50px;">
                        <h2 style="color: #f23f43;">❌ Błąd:</h2>
                        <p>${err.message}</p>
                        <a href="/dashboard" style="color: #5865F2; font-weight: bold; text-decoration: none;">Wróć do panelu</a>
                    </div>
                `);
            }
            next();
        });
    };
}

module.exports = {
    handleUploadMiddleware,
    processUploadedFile
};
