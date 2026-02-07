document.addEventListener('DOMContentLoaded', () => {
    // =================== КОНСТАНТЫ И ПЕРЕМЕННЫЕ ===================
    const canvas = document.getElementById('tetris');
    const context = canvas.getContext('2d');
    const scoreElement = document.getElementById('score');
    const levelElement = document.getElementById('level');
    const linesElement = document.getElementById('lines');
    const startButton = document.getElementById('start');
    const pauseButton = document.getElementById('pause');
    
    // Размеры игрового поля
    const COLS = 10;
    const ROWS = 20;
    const BLOCK_SIZE = 30;
    
    // Цвета блоков
    const COLORS = [
        null,
        '#FF0D72', // I
        '#0DC2FF', // J
        '#0DFF72', // L
        '#F538FF', // O
        '#FF8E0D', // S
        '#FFE138', // T
        '#3877FF'  // Z
    ];
    
    // Фигуры тетрамино
    const SHAPES = [
        null,
        [
            [0,0,0,0],
            [1,1,1,1],
            [0,0,0,0],
            [0,0,0,0]
        ],
        [
            [2,0,0],
            [2,2,2],
            [0,0,0]
        ],
        [
            [0,0,3],
            [3,3,3],
            [0,0,0]
        ],
        [
            [4,4],
            [4,4]
        ],
        [
            [0,5,5],
            [5,5,0],
            [0,0,0]
        ],
        [
            [0,6,0],
            [6,6,6],
            [0,0,0]
        ],
        [
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
        dropInterval: 1000,
        dropCounter: 0,
        gameOver: false,
        paused: false
    };
    
    // =================== ФУНКЦИИ ===================
    function createMatrix(w, h) {
        const matrix = [];
        while (h--) matrix.push(new Array(w).fill(0));
        return matrix;
    }
    
    function createPiece(type) {
        return SHAPES[type].map(row => [...row]);
    }
    
    function drawMatrix(matrix, offset) {
        matrix.forEach((row, y) => {
            row.forEach((value, x) => {
                if (value !== 0) {
                    // Рисуем блок с градиентом
                    context.fillStyle = COLORS[value];
                    
                    // Основной блок
                    context.fillRect(
                        (x + offset.x) * BLOCK_SIZE,
                        (y + offset.y) * BLOCK_SIZE,
                        BLOCK_SIZE,
                        BLOCK_SIZE
                    );
                    
                    // Тень
                    context.strokeStyle = 'rgba(0, 0, 0, 0.3)';
                    context.lineWidth = 2;
                    context.strokeRect(
                        (x + offset.x) * BLOCK_SIZE,
                        (y + offset.y) * BLOCK_SIZE,
                        BLOCK_SIZE,
                        BLOCK_SIZE
                    );
                    
                    // Светлый блик
                    context.fillStyle = 'rgba(255, 255, 255, 0.2)';
                    context.fillRect(
                        (x + offset.x) * BLOCK_SIZE,
                        (y + offset.y) * BLOCK_SIZE,
                        BLOCK_SIZE - 2,
                        2
                    );
                    context.fillRect(
                        (x + offset.x) * BLOCK_SIZE,
                        (y + offset.y) * BLOCK_SIZE,
                        2,
                        BLOCK_SIZE - 2
                    );
                }
            });
        });
    }
    
    function draw() {
        // Очищаем канвас
        context.clearRect(0, 0, canvas.width, canvas.height);
        
        // Рисуем сетку
        context.strokeStyle = 'rgba(255, 255, 255, 0.1)';
        context.lineWidth = 1;
        
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
        
        // Рисуем поле и текущую фигуру
        drawMatrix(board, {x: 0, y: 0});
        if (player.matrix) {
            drawMatrix(player.matrix, player.pos);
        }
        
        // Рисуем следующую фигуру (превью)
        if (nextPiece) {
            context.globalAlpha = 0.7;
            drawMatrix(nextPiece, {x: COLS + 2, y: 2});
            context.globalAlpha = 1.0;
            
            // Подпись
            context.fillStyle = 'white';
            context.font = '14px Arial';
            context.fillText('Следующая:', (COLS + 2) * BLOCK_SIZE, 15);
        }
        
        // Сообщение о паузе
        if (player.paused && !player.gameOver) {
            context.fillStyle = 'rgba(0, 0, 0, 0.7)';
            context.fillRect(0, 0, canvas.width, canvas.height);
            
            context.fillStyle = 'white';
            context.font = 'bold 24px Arial';
            context.textAlign = 'center';
            context.fillText('ПАУЗА', canvas.width / 2, canvas.height / 2);
            context.font = '16px Arial';
            context.fillText('Нажмите P для продолжения', canvas.width / 2, canvas.height / 2 + 30);
            context.textAlign = 'left';
        }
        
        // Сообщение о конце игры
        if (player.gameOver) {
            context.fillStyle = 'rgba(0, 0, 0, 0.8)';
            context.fillRect(0, 0, canvas.width, canvas.height);
            
            context.fillStyle = 'white';
            context.font = 'bold 28px Arial';
            context.textAlign = 'center';
            context.fillText('ИГРА ОКОНЧЕНА', canvas.width / 2, canvas.height / 2 - 30);
            context.font = '18px Arial';
            context.fillText(`Ваш счёт: ${player.score}`, canvas.width / 2, canvas.height / 2 + 10);
            context.fillText('Нажмите "Старт" для новой игры', canvas.width / 2, canvas.height / 2 + 40);
            context.textAlign = 'left';
        }
    }
    
    function merge(board, player) {
        player.matrix.forEach((row, y) => {
            row.forEach((value, x) => {
                if (value !== 0) {
                    board[y + player.pos.y][x + player.pos.x] = value;
                }
            });
        });
    }
    
    function collide(board, player) {
        const [m, o] = [player.matrix, player.pos];
        for (let y = 0; y < m.length; y++) {
            for (let x = 0; x < m[y].length; x++) {
                if (m[y][x] !== 0 &&
                    (board[y + o.y] && board[y + o.y][x + o.x]) !== 0 ||
                    (board[y + o.y] === undefined || board[y + o.y][x + o.x] === undefined)) {
                    return true;
                }
            }
        }
        return false;
    }
    
    function playerMove(dir) {
        if (player.paused || player.gameOver) return;
        
        player.pos.x += dir;
        if (collide(board, player)) {
            player.pos.x -= dir;
        }
        draw();
    }
    
    function playerRotate() {
        if (player.paused || player.gameOver) return;
        
        const pos = player.pos.x;
        let offset = 1;
        rotate(player.matrix);
        
        while (collide(board, player)) {
            player.pos.x += offset;
            offset = -(offset + (offset > 0 ? 1 : -1));
            if (offset > player.matrix[0].length) {
                rotate(player.matrix);
                player.pos.x = pos;
                return;
            }
        }
        draw();
    }
    
    function rotate(matrix) {
        for (let y = 0; y < matrix.length; y++) {
            for (let x = 0; x < y; x++) {
                [matrix[x][y], matrix[y][x]] = [matrix[y][x], matrix[x][y]];
            }
        }
        matrix.forEach(row => row.reverse());
    }
    
    function playerDrop() {
        if (player.paused || player.gameOver) return;
        
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
        if (player.paused || player.gameOver) return;
        
        while (!collide(board, player)) {
            player.pos.y++;
        }
        player.pos.y--;
        playerDrop();
    }
    
    function playerReset() {
        // Случайная фигура
        const pieces = 'IJLOSTZ';
        player.matrix = createPiece(pieces.charCodeAt(Math.floor(Math.random() * pieces.length)) % 7 + 1);
        player.pos.y = 0;
        player.pos.x = Math.floor(COLS / 2) - Math.floor(player.matrix[0].length / 2);
        
        // Следующая фигура
        nextPiece = createPiece(pieces.charCodeAt(Math.floor(Math.random() * pieces.length)) % 7 + 1);
        
        // Проверка на конец игры
        if (collide(board, player)) {
            player.gameOver = true;
            // Отправляем финальный счёт в Telegram
            sendScoreToBot();
        }
    }
    
    function sweep() {
        let rowCount = 0;
        outer: for (let y = board.length - 1; y >= 0; y--) {
            for (let x = 0; x < board[y].length; x++) {
                if (board[y][x] === 0) {
                    continue outer;
                }
            }
            
            // Удаляем заполненную строку
            const row = board.splice(y, 1)[0].fill(0);
            board.unshift(row);
            rowCount++;
            y++;
        }
        
        if (rowCount > 0) {
            // Начисляем очки
            player.lines += rowCount;
            player.score += rowCount * 100 * player.level;
            
            // Увеличиваем уровень каждые 10 линий
            player.level = Math.floor(player.lines / 10) + 1;
            
            // Ускоряем игру
            player.dropInterval = Math.max(100, 1000 - (player.level - 1) * 100);
            
            // Отправляем промежуточный счёт
            sendScoreToBot();
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
        if (player.gameOver) return;
        
        player.paused = !player.paused;
        pauseButton.textContent = player.paused ? '▶️' : '⏸️';
        draw();
    }
    
    // =================== ИГРОВОЙ ЦИКЛ ===================
    let lastTime = 0;
    let nextPiece = null;
    
    function update(time = 0) {
        const deltaTime = time - lastTime;
        lastTime = time;
        
        if (!player.paused && !player.gameOver) {
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
            case 'ArrowLeft': playerMove(-1); break;
            case 'ArrowRight': playerMove(1); break;
            case 'ArrowUp': playerRotate(); break;
            case 'ArrowDown': playerDrop(); break;
            case ' ': playerDropInstant(); break;
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
    
    // Запускаем игру
    update();
    draw();
});
