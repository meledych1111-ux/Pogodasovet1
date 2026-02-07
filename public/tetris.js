document.addEventListener('DOMContentLoaded', () => {
    // =================== КОНСТАНТЫ И ПЕРЕМЕННЫЕ ===================
    const canvas = document.getElementById('tetris');
    const context = canvas.getContext('2d');
    const scoreElement = document.getElementById('score');
    const levelElement = document.getElementById('level');
    const linesElement = document.getElementById('lines');
    const startButton = document.getElementById('start');
    const pauseButton = document.getElementById('pause');
    
    // Размеры игрового поля - классический Tetris
    const COLS = 10;
    const ROWS = 20;
    const BLOCK_SIZE = 25; // Уменьшен размер для лучшего обзора
    
    // Цвета блоков в классическом стиле
    const COLORS = [
        null,
        '#00FFFF', // I - голубой
        '#0000FF', // J - синий
        '#FF8800', // L - оранжевый
        '#FFFF00', // O - желтый
        '#00FF00', // S - зеленый
        '#800080', // T - фиолетовый
        '#FF0000'  // Z - красный
    ];
    
    // Названия фигур
    const PIECE_NAMES = ['', 'I', 'J', 'L', 'O', 'S', 'T', 'Z'];
    
    // Фигуры тетрамино
    const SHAPES = [
        null,
        [ // I
            [0,0,0,0],
            [1,1,1,1],
            [0,0,0,0],
            [0,0,0,0]
        ],
        [ // J
            [2,0,0],
            [2,2,2],
            [0,0,0]
        ],
        [ // L
            [0,0,3],
            [3,3,3],
            [0,0,0]
        ],
        [ // O
            [4,4],
            [4,4]
        ],
        [ // S
            [0,5,5],
            [5,5,0],
            [0,0,0]
        ],
        [ // T
            [0,6,0],
            [6,6,6],
            [0,0,0]
        ],
        [ // Z
            [7,7,0],
            [0,7,7],
            [0,0,0]
        ]
    ];
    
    // Игровые переменные
    let board = createMatrix(COLS, ROWS);
    let player = {
        pos: {x: 0, y: 0},
        matrix: null,
        score: 0,
        level: 1,
        lines: 0,
        dropInterval: 1000, // Начальная скорость - 1 блок в секунду
        dropCounter: 0,
        gameOver: false,
        paused: false,
        nextPiece: null,
        nextPieceType: 0
    };
    
    // =================== ФУНКЦИИ ===================
    function createMatrix(w, h) {
        const matrix = [];
        for (let i = 0; i < h; i++) {
            matrix.push(new Array(w).fill(0));
        }
        return matrix;
    }
    
    function createPiece(type) {
        // Создаем глубокую копию фигуры
        return JSON.parse(JSON.stringify(SHAPES[type]));
    }
    
    function drawBlock(x, y, color) {
        // Основной блок
        context.fillStyle = color;
        context.fillRect(x * BLOCK_SIZE, y * BLOCK_SIZE, BLOCK_SIZE, BLOCK_SIZE);
        
        // Внешняя рамка
        context.strokeStyle = 'rgba(255, 255, 255, 0.3)';
        context.lineWidth = 1;
        context.strokeRect(x * BLOCK_SIZE, y * BLOCK_SIZE, BLOCK_SIZE, BLOCK_SIZE);
        
        // Внутренний градиент для объема
        const gradient = context.createLinearGradient(
            x * BLOCK_SIZE, 
            y * BLOCK_SIZE, 
            x * BLOCK_SIZE + BLOCK_SIZE, 
            y * BLOCK_SIZE + BLOCK_SIZE
        );
        gradient.addColorStop(0, 'rgba(255, 255, 255, 0.1)');
        gradient.addColorStop(1, 'rgba(0, 0, 0, 0.1)');
        
        context.fillStyle = gradient;
        context.fillRect(x * BLOCK_SIZE, y * BLOCK_SIZE, BLOCK_SIZE, BLOCK_SIZE);
        
        // Яркий край для объема
        context.strokeStyle = 'rgba(255, 255, 255, 0.5)';
        context.lineWidth = 1;
        context.beginPath();
        context.moveTo(x * BLOCK_SIZE, y * BLOCK_SIZE);
        context.lineTo(x * BLOCK_SIZE + BLOCK_SIZE, y * BLOCK_SIZE);
        context.lineTo(x * BLOCK_SIZE + BLOCK_SIZE, y * BLOCK_SIZE + BLOCK_SIZE);
        context.stroke();
    }
    
    function drawMatrix(matrix, offset) {
        matrix.forEach((row, y) => {
            row.forEach((value, x) => {
                if (value !== 0) {
                    drawBlock(x + offset.x, y + offset.y, COLORS[value]);
                }
            });
        });
    }
    
    function drawBoard() {
        // Рисуем черный фон игрового поля
        context.fillStyle = '#111';
        context.fillRect(0, 0, COLS * BLOCK_SIZE, ROWS * BLOCK_SIZE);
        
        // Рисуем сетку игрового поля
        context.strokeStyle = 'rgba(255, 255, 255, 0.1)';
        context.lineWidth = 0.5;
        
        // Вертикальные линии
        for (let x = 0; x <= COLS; x++) {
            context.beginPath();
            context.moveTo(x * BLOCK_SIZE, 0);
            context.lineTo(x * BLOCK_SIZE, ROWS * BLOCK_SIZE);
            context.stroke();
        }
        
        // Горизонтальные линии
        for (let y = 0; y <= ROWS; y++) {
            context.beginPath();
            context.moveTo(0, y * BLOCK_SIZE);
            context.lineTo(COLS * BLOCK_SIZE, y * BLOCK_SIZE);
            context.stroke();
        }
    }
    
    function draw() {
        // Очищаем весь канвас
        context.clearRect(0, 0, canvas.width, canvas.height);
        
        // Рисуем игровое поле
        drawBoard();
        
        // Рисуем установленные блоки
        drawMatrix(board, {x: 0, y: 0});
        
        // Рисуем текущую фигуру
        if (player.matrix) {
            drawMatrix(player.matrix, player.pos);
        }
        
        // Рисуем следующую фигуру
        if (player.nextPiece) {
            // Фон для панели следующей фигуры
            context.fillStyle = 'rgba(0, 0, 0, 0.5)';
            context.fillRect((COLS + 1) * BLOCK_SIZE, 0, 4 * BLOCK_SIZE, 5 * BLOCK_SIZE);
            
            // Заголовок
            context.fillStyle = 'white';
            context.font = 'bold 16px Arial';
            context.textAlign = 'center';
            context.fillText('Следующая:', (COLS + 3) * BLOCK_SIZE, 20);
            
            // Рисуем следующую фигуру
            drawMatrix(player.nextPiece, {x: COLS + 2, y: 2});
        }
        
        // Рисуем информацию о игре
        const infoX = COLS + 1;
        const infoY = 6;
        
        // Фон для информации
        context.fillStyle = 'rgba(0, 0, 0, 0.5)';
        context.fillRect(infoX * BLOCK_SIZE, infoY * BLOCK_SIZE, 4 * BLOCK_SIZE, 7 * BLOCK_SIZE);
        
        // Информация
        context.fillStyle = 'white';
        context.font = '14px Arial';
        context.textAlign = 'left';
        
        context.fillText('Скорость:', (infoX + 0.5) * BLOCK_SIZE, (infoY + 1) * BLOCK_SIZE);
        const speed = Math.round(1000 / player.dropInterval * 10) / 10;
        context.fillText(speed + ' бл/с', (infoX + 2) * BLOCK_SIZE, (infoY + 1) * BLOCK_SIZE);
        
        context.fillText('След. уровень:', (infoX + 0.5) * BLOCK_SIZE, (infoY + 2) * BLOCK_SIZE);
        const linesToNext = 10 - (player.lines % 10);
        context.fillText(linesToNext + ' линий', (infoX + 2) * BLOCK_SIZE, (infoY + 2) * BLOCK_SIZE);
        
        context.fillText('Фигура:', (infoX + 0.5) * BLOCK_SIZE, (infoY + 3) * BLOCK_SIZE);
        if (player.nextPieceType > 0) {
            context.fillText(PIECE_NAMES[player.nextPieceType], (infoX + 2) * BLOCK_SIZE, (infoY + 3) * BLOCK_SIZE);
        }
        
        // Сообщение о паузе
        if (player.paused && !player.gameOver) {
            context.fillStyle = 'rgba(0, 0, 0, 0.8)';
            context.fillRect(0, 0, COLS * BLOCK_SIZE, ROWS * BLOCK_SIZE);
            
            context.fillStyle = 'white';
            context.font = 'bold 28px Arial';
            context.textAlign = 'center';
            context.fillText('ПАУЗА', COLS * BLOCK_SIZE / 2, ROWS * BLOCK_SIZE / 2 - 20);
            context.font = '18px Arial';
            context.fillText('Нажмите P для продолжения', COLS * BLOCK_SIZE / 2, ROWS * BLOCK_SIZE / 2 + 20);
            context.textAlign = 'left';
        }
        
        // Сообщение о конце игры
        if (player.gameOver) {
            context.fillStyle = 'rgba(0, 0, 0, 0.9)';
            context.fillRect(0, 0, COLS * BLOCK_SIZE, ROWS * BLOCK_SIZE);
            
            context.fillStyle = 'white';
            context.font = 'bold 32px Arial';
            context.textAlign = 'center';
            context.fillText('GAME OVER', COLS * BLOCK_SIZE / 2, ROWS * BLOCK_SIZE / 2 - 40);
            context.font = '24px Arial';
            context.fillText(`Счёт: ${player.score}`, COLS * BLOCK_SIZE / 2, ROWS * BLOCK_SIZE / 2);
            context.font = '18px Arial';
            context.fillText('Нажмите "Старт" для новой игры', COLS * BLOCK_SIZE / 2, ROWS * BLOCK_SIZE / 2 + 40);
            context.textAlign = 'left';
        }
    }
    
    function merge(board, player) {
        player.matrix.forEach((row, y) => {
            row.forEach((value, x) => {
                if (value !== 0) {
                    const boardY = y + player.pos.y;
                    const boardX = x + player.pos.x;
                    if (boardY >= 0 && boardY < ROWS && boardX >= 0 && boardX < COLS) {
                        board[boardY][boardX] = value;
                    }
                }
            });
        });
    }
    
    function collide(board, player) {
        const [m, o] = [player.matrix, player.pos];
        
        for (let y = 0; y < m.length; y++) {
            for (let x = 0; x < m[y].length; x++) {
                if (m[y][x] !== 0) {
                    const boardY = y + o.y;
                    const boardX = x + o.x;
                    
                    // Проверка выхода за границы
                    if (boardX < 0 || boardX >= COLS || boardY >= ROWS) {
                        return true;
                    }
                    
                    // Проверка столкновения с другими блоками
                    if (boardY >= 0 && board[boardY][boardX] !== 0) {
                        return true;
                    }
                }
            }
        }
        return false;
    }
    
    function playerMove(dir) {
        if (player.paused || player.gameOver || !player.matrix) return;
        
        player.pos.x += dir;
        if (collide(board, player)) {
            player.pos.x -= dir;
        }
        draw();
    }
    
    function playerRotate() {
        if (player.paused || player.gameOver || !player.matrix) return;
        
        const pos = player.pos.x;
        const originalMatrix = JSON.parse(JSON.stringify(player.matrix));
        let offset = 1;
        
        rotate(player.matrix);
        
        while (collide(board, player)) {
            player.pos.x += offset;
            offset = -(offset + (offset > 0 ? 1 : -1));
            if (Math.abs(offset) > player.matrix[0].length) {
                player.pos.x = pos;
                player.matrix = originalMatrix;
                return;
            }
        }
        draw();
    }
    
    function rotate(matrix) {
        const N = matrix.length;
        const M = matrix[0].length;
        const rotated = [];
        
        for (let i = 0; i < M; i++) {
            rotated[i] = [];
            for (let j = 0; j < N; j++) {
                rotated[i][j] = matrix[N - 1 - j][i];
            }
        }
        
        // Копируем результат обратно в исходную матрицу
        matrix.length = 0;
        for (let i = 0; i < rotated.length; i++) {
            matrix[i] = rotated[i];
        }
    }
    
    function playerDrop() {
        if (player.paused || player.gameOver || !player.matrix) return;
        
        player.pos.y++;
        if (collide(board, player)) {
            player.pos.y--;
            merge(board, player);
            playerReset();
            sweep();
            updateScore();
        }
        player.dropCounter = 0;
        draw();
    }
    
    function playerDropInstant() {
        if (player.paused || player.gameOver || !player.matrix) return;
        
        while (!collide(board, player)) {
            player.pos.y++;
        }
        player.pos.y--;
        merge(board, player);
        playerReset();
        sweep();
        updateScore();
        draw();
    }
    
    function playerReset() {
        // Если нет следующей фигуры, создаем новую случайную
        if (!player.nextPiece) {
            const pieces = 'IJLOSTZ';
            player.nextPieceType = pieces.charCodeAt(Math.floor(Math.random() * pieces.length)) % 7 + 1;
            player.nextPiece = createPiece(player.nextPieceType);
        }
        
        // Текущая фигура становится следующей
        player.matrix = player.nextPiece;
        player.pos.y = 0;
        player.pos.x = Math.floor(COLS / 2) - Math.floor(player.matrix[0].length / 2);
        
        // Генерируем новую следующую фигуру
        const pieces = 'IJLOSTZ';
        player.nextPieceType = pieces.charCodeAt(Math.floor(Math.random() * pieces.length)) % 7 + 1;
        player.nextPiece = createPiece(player.nextPieceType);
        
        // Проверка на конец игры
        if (collide(board, player)) {
            player.gameOver = true;
            // Отправляем финальный счёт в Telegram
            sendScoreToBot();
        }
    }
    
    function sweep() {
        let rowCount = 0;
        let linesCleared = 0;
        
        for (let y = ROWS - 1; y >= 0; y--) {
            let isRowFull = true;
            
            for (let x = 0; x < COLS; x++) {
                if (board[y][x] === 0) {
                    isRowFull = false;
                    break;
                }
            }
            
            if (isRowFull) {
                const row = board.splice(y, 1)[0];
                row.fill(0);
                board.unshift(row);
                y++; // Проверяем эту же позицию снова
                linesCleared++;
                rowCount++;
            }
        }
        
        if (rowCount > 0) {
            // Начисляем очки по классическим правилам Tetris
            const linePoints = [40, 100, 300, 1200];
            player.score += linePoints[rowCount - 1] * player.level;
            player.lines += rowCount;
            
            // Увеличиваем уровень каждые 10 линий
            const newLevel = Math.floor(player.lines / 10) + 1;
            if (newLevel > player.level) {
                player.level = newLevel;
                // Увеличиваем скорость постепенно (максимум 20 уровней для комфортной игры)
                if (player.level <= 20) {
                    player.dropInterval = Math.max(100, 1000 - (player.level - 1) * 50);
                }
            }
            
            // Отправляем промежуточный счёт
            sendScoreToBot();
            updateScore();
        }
    }
    
    function updateScore() {
        scoreElement.textContent = player.score;
        levelElement.textContent = player.level;
        linesElement.textContent = player.lines;
    }
    
    function sendScoreToBot() {
        // Отправляем данные в родительское приложение Telegram
        if (window.Telegram && Telegram.WebApp) {
            const data = {
                action: 'tetris_score',
                score: player.score,
                level: player.level,
                lines: player.lines,
                gameOver: player.gameOver
            };
            Telegram.WebApp.sendData(JSON.stringify(data));
        }
    }
    
    function startGame() {
        if (player.gameOver) {
            // Сброс игры
            board = createMatrix(COLS, ROWS);
            player.score = 0;
            player.level = 1;
            player.lines = 0;
            player.dropInterval = 1000;
            player.gameOver = false;
            player.paused = false;
            player.nextPiece = null;
            player.nextPieceType = 0;
            updateScore();
        }
        
        if (!player.matrix) {
            playerReset();
        }
        
        player.paused = false;
        startButton.textContent = '▶️ Старт';
        pauseButton.textContent = '⏸️';
        draw();
    }
    
    function togglePause() {
        if (player.gameOver || !player.matrix) return;
        
        player.paused = !player.paused;
        pauseButton.textContent = player.paused ? '▶️' : '⏸️';
        draw();
    }
    
    // =================== ИГРОВОЙ ЦИКЛ ===================
    let lastTime = 0;
    
    function update(time = 0) {
        const deltaTime = time - lastTime;
        lastTime = time;
        
        if (!player.paused && !player.gameOver && player.matrix) {
            player.dropCounter += deltaTime;
            if (player.dropCounter > player.dropInterval) {
                playerDrop();
            }
        }
        
        draw();
        requestAnimationFrame(update);
    }
    
    // =================== УПРАВЛЕНИЕ ===================
    // Кнопки
    document.getElementById('left').addEventListener('click', () => playerMove(-1));
    document.getElementById('right').addEventListener('click', () => playerMove(1));
    document.getElementById('rotate').addEventListener('click', () => playerRotate());
    document.getElementById('down').addEventListener('click', () => playerDrop());
    document.getElementById('drop').addEventListener('click', () => playerDropInstant());
    startButton.addEventListener('click', startGame);
    pauseButton.addEventListener('click', togglePause);
    
    // Клавиатура
    document.addEventListener('keydown', event => {
        if (player.gameOver && event.key !== ' ') return;
        
        switch(event.key) {
            case 'ArrowLeft': 
            case 'a':
            case 'A':
            case 'ф':
            case 'Ф':
                playerMove(-1); 
                break;
            case 'ArrowRight': 
            case 'd':
            case 'D':
            case 'в':
            case 'В':
                playerMove(1); 
                break;
            case 'ArrowUp': 
            case 'w':
            case 'W':
            case 'ц':
            case 'Ц':
                playerRotate(); 
                break;
            case 'ArrowDown': 
            case 's':
            case 'S':
            case 'ы':
            case 'Ы':
                playerDrop(); 
                break;
            case ' ': 
                playerDropInstant(); 
                break;
            case 'p':
            case 'P':
            case 'з':
            case 'З':
                togglePause();
                break;
        }
    });
    
    // =================== ИНИЦИАЛИЗАЦИЯ ===================
    // Инициализируем Telegram Web App
    if (window.Telegram && Telegram.WebApp) {
        Telegram.WebApp.expand();
        Telegram.WebApp.ready();
        
        // Настраиваем цветовую схему под Telegram
        document.body.style.backgroundColor = Telegram.WebApp.backgroundColor;
    }
    
    // Устанавливаем правильный размер канваса
    canvas.width = (COLS + 6) * BLOCK_SIZE; // Дополнительное место для информации
    canvas.height = ROWS * BLOCK_SIZE;
    
    // Запускаем игру
    update();
    draw();
});
