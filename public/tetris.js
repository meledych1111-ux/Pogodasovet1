document.addEventListener('DOMContentLoaded', () => {
    // =================== КОНСТАНТЫ ===================
    const canvas = document.getElementById('tetris');
    const context = canvas.getContext('2d');
    const scoreElement = document.getElementById('score');
    const levelElement = document.getElementById('level');
    const linesElement = document.getElementById('lines');
    const startButton = document.getElementById('start');
    const pauseButton = document.getElementById('pause');
    
    // Оптимальные размеры для мобильных устройств
    const COLS = 12; // Увеличили ширину для большего поля
    const ROWS = 22; // Увеличили высоту
    const BLOCK_SIZE = Math.min(
        Math.floor(window.innerWidth * 0.8 / COLS),
        Math.floor(window.innerHeight * 0.5 / ROWS)
    );
    
    // Цвета в стиле K-Drama (пастельные, красивые)
    const COLORS = [
        null,
        '#FFB6C1', // I - светло-розовый (как сакура)
        '#87CEEB', // J - небесно-голубой
        '#98FB98', // L - мятно-зеленый
        '#FFD700', // O - золотой
        '#DA70D6', // S - орхидея
        '#FFA07A', // T - светло-лососевый
        '#BA55D3'  // Z - средняя орхидея
    ];
    
    // Тени для объемности
    const SHADOW_COLORS = [
        null,
        '#FF69B4', // I
        '#1E90FF', // J
        '#32CD32', // L
        '#FF8C00', // O
        '#9932CC', // S
        '#FF4500', // T
        '#8A2BE2'  // Z
    ];
    
    // Фигуры (немного уменьшены для большего поля)
    const SHAPES = [
        null,
        [ // I
            [0,0,0,0,0],
            [0,0,0,0,0],
            [1,1,1,1,0],
            [0,0,0,0,0],
            [0,0,0,0,0]
        ],
        [ // J
            [0,0,0,0],
            [2,0,0,0],
            [2,2,2,0],
            [0,0,0,0]
        ],
        [ // L
            [0,0,0,0],
            [0,0,3,0],
            [3,3,3,0],
            [0,0,0,0]
        ],
        [ // O
            [0,0,0,0],
            [0,4,4,0],
            [0,4,4,0],
            [0,0,0,0]
        ],
        [ // S
            [0,0,0,0],
            [0,5,5,0],
            [5,5,0,0],
            [0,0,0,0]
        ],
        [ // T
            [0,0,0,0],
            [0,6,0,0],
            [6,6,6,0],
            [0,0,0,0]
        ],
        [ // Z
            [0,0,0,0],
            [7,7,0,0],
            [0,7,7,0],
            [0,0,0,0]
        ]
    ];
    
    // =================== ИГРОВЫЕ ПЕРЕМЕННЫЕ ===================
    let board = createMatrix(COLS, ROWS);
    let player = {
        pos: {x: 0, y: 0},
        matrix: null,
        score: 0,
        level: 1,
        lines: 0,
        dropInterval: 1200, // Медленнее для начала
        dropCounter: 0,
        gameOver: false,
        paused: false,
        nextPiece: null,
        lastMoveTime: 0,
        moveDelay: 100 // Задержка между движениями для предотвращения дерганий
    };
    
    // =================== ИНИЦИАЛИЗАЦИЯ КАНВАСА ===================
    function initCanvas() {
        const container = canvas.parentElement;
        const containerWidth = container.clientWidth - 16; // Учитываем padding
        const containerHeight = container.clientHeight - 16;
        
        const blockSize = Math.min(
            Math.floor(containerWidth / COLS),
            Math.floor(containerHeight / ROWS)
        );
        
        canvas.width = COLS * blockSize;
        canvas.height = ROWS * blockSize;
        
        // Отключаем масштабирование на тач-устройствах
        canvas.style.touchAction = 'none';
        canvas.style.webkitTouchCallout = 'none';
        canvas.style.webkitUserSelect = 'none';
        
        draw();
    }
    
    // =================== ОСНОВНЫЕ ФУНКЦИИ ===================
    function createMatrix(w, h) {
        const matrix = [];
        for (let i = 0; i < h; i++) {
            matrix.push(new Array(w).fill(0));
        }
        return matrix;
    }
    
    function createPiece(type) {
        return JSON.parse(JSON.stringify(SHAPES[type]));
    }
    
    // Улучшенная отрисовка блоков с градиентами
    function drawBlock(x, y, colorIndex) {
        const color = COLORS[colorIndex];
        const shadowColor = SHADOW_COLORS[colorIndex];
        const size = BLOCK_SIZE;
        
        // Основной блок с градиентом
        const gradient = context.createLinearGradient(
            x * size, y * size,
            x * size + size, y * size + size
        );
        gradient.addColorStop(0, color);
        gradient.addColorStop(1, shadowColor);
        
        context.fillStyle = gradient;
        context.fillRect(x * size, y * size, size, size);
        
        // Внутренняя тень для объема
        context.strokeStyle = 'rgba(255, 255, 255, 0.3)';
        context.lineWidth = 1;
        context.strokeRect(x * size + 1, y * size + 1, size - 2, size - 2);
        
        // Блик сверху
        context.fillStyle = 'rgba(255, 255, 255, 0.2)';
        context.fillRect(x * size, y * size, size, 2);
        context.fillRect(x * size, y * size, 2, size);
        
        // Тень снизу
        context.fillStyle = 'rgba(0, 0, 0, 0.2)';
        context.fillRect(x * size + 2, y * size + size - 2, size - 2, 2);
        context.fillRect(x * size + size - 2, y * size + 2, 2, size - 2);
    }
    
    function drawMatrix(matrix, offset) {
        matrix.forEach((row, y) => {
            row.forEach((value, x) => {
                if (value !== 0) {
                    drawBlock(x + offset.x, y + offset.y, value);
                }
            });
        });
    }
    
    function drawBoard() {
        // Градиентный фон поля
        const bgGradient = context.createLinearGradient(0, 0, 0, canvas.height);
        bgGradient.addColorStop(0, '#1a1a2e');
        bgGradient.addColorStop(1, '#16213e');
        context.fillStyle = bgGradient;
        context.fillRect(0, 0, canvas.width, canvas.height);
        
        // Сетка поля (более тонкая)
        context.strokeStyle = 'rgba(255, 255, 255, 0.08)';
        context.lineWidth = 0.5;
        
        // Вертикальные линии
        for (let x = 0; x <= COLS; x++) {
            context.beginPath();
            context.moveTo(x * BLOCK_SIZE, 0);
            context.lineTo(x * BLOCK_SIZE, canvas.height);
            context.stroke();
        }
        
        // Горизонтальные линии
        for (let y = 0; y <= ROWS; y++) {
            context.beginPath();
            context.moveTo(0, y * BLOCK_SIZE);
            context.lineTo(canvas.width, y * BLOCK_SIZE);
            context.stroke();
        }
        
        // Обводка поля
        context.strokeStyle = 'rgba(255, 255, 255, 0.1)';
        context.lineWidth = 2;
        context.strokeRect(0, 0, canvas.width, canvas.height);
    }
    
    function drawNextPiece() {
        if (!player.nextPiece) return;
        
        const size = BLOCK_SIZE * 0.7; // Уменьшенный размер для панели предпросмотра
        const offsetX = COLS + 1;
        const offsetY = 1;
        
        // Фон панели предпросмотра
        context.fillStyle = 'rgba(255, 255, 255, 0.1)';
        context.fillRect(offsetX * BLOCK_SIZE, offsetY * BLOCK_SIZE, 5 * size, 5 * size);
        context.strokeStyle = 'rgba(255, 255, 255, 0.2)';
        context.lineWidth = 1;
        context.strokeRect(offsetX * BLOCK_SIZE, offsetY * BLOCK_SIZE, 5 * size, 5 * size);
        
        // Текст
        context.fillStyle = 'white';
        context.font = 'bold 12px Arial';
        context.textAlign = 'center';
        context.fillText('Следующая:', offsetX * BLOCK_SIZE + 2.5 * size, offsetY * BLOCK_SIZE - 5);
        
        // Отрисовка уменьшенной фигуры
        player.nextPiece.forEach((row, y) => {
            row.forEach((value, x) => {
                if (value !== 0) {
                    const color = COLORS[value];
                    context.fillStyle = color;
                    context.fillRect(
                        offsetX * BLOCK_SIZE + x * size,
                        offsetY * BLOCK_SIZE + y * size,
                        size - 1,
                        size - 1
                    );
                }
            });
        });
    }
    
    function draw() {
        // Очистка
        context.clearRect(0, 0, canvas.width, canvas.height);
        
        // Рисуем поле
        drawBoard();
        
        // Рисуем установленные блоки
        drawMatrix(board, {x: 0, y: 0});
        
        // Рисуем текущую фигуру
        if (player.matrix) {
            drawMatrix(player.matrix, player.pos);
        }
        
        // Рисуем следующую фигуру
        drawNextPiece();
        
        // Сообщения о состоянии игры
        if (player.paused && !player.gameOver) {
            context.fillStyle = 'rgba(0, 0, 0, 0.85)';
            context.fillRect(0, 0, canvas.width, canvas.height);
            
            context.fillStyle = '#FFD700';
            context.font = 'bold 28px Arial';
            context.textAlign = 'center';
            context.fillText('ПАУЗА', canvas.width / 2, canvas.height / 2 - 20);
            context.font = '16px Arial';
            context.fillStyle = 'white';
            context.fillText('Нажмите ПАУЗА или P', canvas.width / 2, canvas.height / 2 + 20);
        }
        
        if (player.gameOver) {
            context.fillStyle = 'rgba(0, 0, 0, 0.9)';
            context.fillRect(0, 0, canvas.width, canvas.height);
            
            context.fillStyle = '#FF6B6B';
            context.font = 'bold 32px Arial';
            context.textAlign = 'center';
            context.fillText('ИГРА ОКОНЧЕНА', canvas.width / 2, canvas.height / 2 - 50);
            
            context.fillStyle = '#FFD700';
            context.font = '24px Arial';
            context.fillText(`Счёт: ${player.score}`, canvas.width / 2, canvas.height / 2);
            
            context.fillStyle = 'white';
            context.font = '18px Arial';
            context.fillText('Нажмите СТАРТ', canvas.width / 2, canvas.height / 2 + 50);
        }
    }
    
    // =================== ИГРОВАЯ ЛОГИКА ===================
    function merge() {
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
    
    function collide() {
        const [m, o] = [player.matrix, player.pos];
        
        for (let y = 0; y < m.length; y++) {
            for (let x = 0; x < m[y].length; x++) {
                if (m[y][x] !== 0) {
                    const boardY = y + o.y;
                    const boardX = x + o.x;
                    
                    // Проверка границ
                    if (boardX < 0 || boardX >= COLS || boardY >= ROWS) {
                        return true;
                    }
                    
                    // Проверка других блоков
                    if (boardY >= 0 && board[boardY][boardX] !== 0) {
                        return true;
                    }
                }
            }
        }
        return false;
    }
    
    // Улучшенное движение с задержкой для тач-устройств
    function playerMove(dir) {
        if (player.paused || player.gameOver || !player.matrix) return;
        
        const now = Date.now();
        if (now - player.lastMoveTime < player.moveDelay) return;
        player.lastMoveTime = now;
        
        player.pos.x += dir;
        if (collide()) {
            player.pos.x -= dir;
        }
        draw();
    }
    
    function playerRotate() {
        if (player.paused || player.gameOver || !player.matrix) return;
        
        const now = Date.now();
        if (now - player.lastMoveTime < player.moveDelay) return;
        player.lastMoveTime = now;
        
        const pos = player.pos.x;
        const originalMatrix = JSON.parse(JSON.stringify(player.matrix));
        let offset = 1;
        
        rotate(player.matrix);
        
        while (collide()) {
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
        
        matrix.length = 0;
        for (let i = 0; i < rotated.length; i++) {
            matrix[i] = rotated[i];
        }
    }
    
    function playerDrop() {
        if (player.paused || player.gameOver || !player.matrix) return;
        
        player.pos.y++;
        if (collide()) {
            player.pos.y--;
            merge();
            playerReset();
            sweep();
        }
        player.dropCounter = 0;
        draw();
    }
    
    function playerDropInstant() {
        if (player.paused || player.gameOver || !player.matrix) return;
        
        while (!collide()) {
            player.pos.y++;
        }
        player.pos.y--;
        merge();
        playerReset();
        sweep();
        draw();
    }
    
    function playerReset() {
        // Если нет следующей фигуры, создаем
        if (!player.nextPiece) {
            const pieces = [1,2,3,4,5,6,7];
            const type = pieces[Math.floor(Math.random() * pieces.length)];
            player.nextPiece = createPiece(type);
        }
        
        // Текущая фигура становится следующей
        player.matrix = player.nextPiece;
        player.pos.y = 0;
        player.pos.x = Math.floor(COLS / 2) - Math.floor(player.matrix[0].length / 2);
        
        // Новая следующая фигура
        const pieces = [1,2,3,4,5,6,7];
        const type = pieces[Math.floor(Math.random() * pieces.length)];
        player.nextPiece = createPiece(type);
        
        // Проверка на конец игры
        if (collide()) {
            player.gameOver = true;
            sendScoreToBot();
        }
    }
    
    function sweep() {
        let rowsCleared = 0;
        
        outer: for (let y = ROWS - 1; y >= 0; y--) {
            for (let x = 0; x < COLS; x++) {
                if (board[y][x] === 0) {
                    continue outer;
                }
            }
            
            // Удаляем заполненную строку
            const row = board.splice(y, 1)[0];
            row.fill(0);
            board.unshift(row);
            rowsCleared++;
            y++; // Проверяем ту же позицию снова
        }
        
        if (rowsCleared > 0) {
            // Классическая система очков Tetris
            const points = [40, 100, 300, 1200];
            player.score += points[Math.min(rowsCleared - 1, 3)] * player.level;
            player.lines += rowsCleared;
            
            // Динамическое увеличение уровня
            const newLevel = Math.floor(player.lines / 10) + 1;
            if (newLevel > player.level) {
                player.level = newLevel;
                // Плавное увеличение скорости (не слишком быстро)
                player.dropInterval = Math.max(150, 1200 - (player.level - 1) * 70);
            }
            
            updateScore();
            sendScoreToBot();
        }
    }
    
    function updateScore() {
        scoreElement.textContent = player.score;
        levelElement.textContent = player.level;
        linesElement.textContent = player.lines;
    }
    
    function sendScoreToBot() {
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
            // Полный сброс
            board = createMatrix(COLS, ROWS);
            player.score = 0;
            player.level = 1;
            player.lines = 0;
            player.dropInterval = 1200;
            player.gameOver = false;
            player.paused = false;
            player.nextPiece = null;
            updateScore();
        }
        
        if (!player.matrix) {
            playerReset();
        }
        
        player.paused = false;
        startButton.innerHTML = '<span>▶️</span><span>СТАРТ</span>';
        pauseButton.innerHTML = '<span>⏸️</span><span>ПАУЗА</span>';
        draw();
    }
    
    function togglePause() {
        if (player.gameOver || !player.matrix) return;
        
        player.paused = !player.paused;
        pauseButton.innerHTML = player.paused 
            ? '<span>▶️</span><span>ПРОДОЛЖИТЬ</span>'
            : '<span>⏸️</span><span>ПАУЗА</span>';
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
    
    // =================== ТАЧ-УПРАВЛЕНИЕ ===================
    let touchStartX = 0;
    let touchStartY = 0;
    let touchStartTime = 0;
    
    canvas.addEventListener('touchstart', (e) => {
        e.preventDefault();
        const touch = e.touches[0];
        touchStartX = touch.clientX;
        touchStartY = touch.clientY;
        touchStartTime = Date.now();
    }, { passive: false });
    
    canvas.addEventListener('touchmove', (e) => {
        e.preventDefault();
    }, { passive: false });
    
    canvas.addEventListener('touchend', (e) => {
        e.preventDefault();
        if (!e.changedTouches[0]) return;
        
        const touch = e.changedTouches[0];
        const deltaX = touch.clientX - touchStartX;
        const deltaY = touch.clientY - touchStartY;
        const deltaTime = Date.now() - touchStartTime;
        const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
        
        // Минимальное расстояние для свайпа
        if (distance < 20) return;
        
        // Определяем направление свайпа
        const angle = Math.atan2(deltaY, deltaX) * 180 / Math.PI;
        const speed = distance / deltaTime;
        
        if (Math.abs(deltaX) > Math.abs(deltaY)) {
            // Горизонтальный свайп
            if (deltaX > 0) {
                playerMove(1); // Вправо
            } else {
                playerMove(-1); // Влево
            }
        } else {
            // Вертикальный свайп
            if (deltaY > 0) {
                if (speed > 0.5) {
                    playerDropInstant(); // Быстрый свайп вниз
                } else {
                    playerDrop(); // Медленный свайп
                }
            } else {
                playerRotate(); // Свайп вверх - поворот
            }
        }
    }, { passive: false });
    
    // =================== КНОПОЧНОЕ УПРАВЛЕНИЕ ===================
    document.getElementById('left').addEventListener('touchstart', (e) => {
        e.preventDefault();
        playerMove(-1);
    });
    
    document.getElementById('right').addEventListener('touchstart', (e) => {
        e.preventDefault();
        playerMove(1);
    });
    
    document.getElementById('rotate').addEventListener('touchstart', (e) => {
        e.preventDefault();
        playerRotate();
    });
    
    document.getElementById('down').addEventListener('touchstart', (e) => {
        e.preventDefault();
        playerDrop();
    });
    
    document.getElementById('drop').addEventListener('touchstart', (e) => {
        e.preventDefault();
        playerDropInstant();
    });
    
    startButton.addEventListener('click', startGame);
    pauseButton.addEventListener('click', togglePause);
    
    // =================== КЛАВИАТУРА ===================
    document.addEventListener('keydown', (e) => {
        if (player.gameOver && e.key !== ' ') return;
        
        switch(e.key) {
            case 'ArrowLeft':
            case 'a':
            case 'A':
                e.preventDefault();
                playerMove(-1);
                break;
            case 'ArrowRight':
            case 'd':
            case 'D':
                e.preventDefault();
                playerMove(1);
                break;
            case 'ArrowUp':
            case 'w':
            case 'W':
                e.preventDefault();
                playerRotate();
                break;
            case 'ArrowDown':
            case 's':
            case 'S':
                e.preventDefault();
                playerDrop();
                break;
            case ' ':
                e.preventDefault();
                playerDropInstant();
                break;
            case 'p':
            case 'P':
            case 'з':
            case 'З':
                e.preventDefault();
                togglePause();
                break;
        }
    });
    
    // =================== ИНИЦИАЛИЗАЦИЯ ===================
    window.addEventListener('load', () => {
        // Telegram Web App
        if (window.Telegram && Telegram.WebApp) {
            Telegram.WebApp.expand();
            Telegram.WebApp.ready();
            document.body.style.backgroundColor = Telegram.WebApp.backgroundColor;
        }
        
        // Инициализация канваса
        initCanvas();
        
        // Адаптация к изменению размера экрана
        window.addEventListener('resize', initCanvas);
        
        // Запуск игры
        update();
        draw();
    });
});
