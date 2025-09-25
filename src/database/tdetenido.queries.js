export async function insertTDetenido(
    client,
    {
        snombre = '',
        sapellidopaterno = '',
        sapellidomaterno = '',
        snombrenormalizado = '',
        irepeticiones = '',
        salias = '',
        ssexo = 'M',
        dtfecha = ''
    }
) {
    const query = `
        INSERT INTO (snombre, sapellidopaterno, sapellidomaterno, snombrenormalizado, irepeticiones, salias, ssexo, dtfecha)
        VALUES($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING iidetenido;
    `
    const values = [
        snombre,
        sapellidopaterno,
        sapellidomaterno,
        snombrenormalizado,
        irepeticiones,
        salias,
        ssexo,
        dtfecha
    ]

    const result = await client.query(query, values)

    return result.rows[0]
}